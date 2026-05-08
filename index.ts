declare var Chart: any;

// Panel specifications based on Solar Images
const PANELS = {
    "580": {
        power: 580,
        efficiency: 22.45,
        areaSqFt: 27.8, // 2278 x 1134 mm
        degYear1: 1.0,
        degYearly: 0.40,
        warrantyYears: 30,
        endOutput: 87.4
    },
    "630": {
        power: 630,
        efficiency: 22.62,
        areaSqFt: 30.0, // 2456 x 1134 mm
        degYear1: 2.0,
        degYearly: 0.75, // Approximated to reach 80% at 25 years
        warrantyYears: 25,
        endOutput: 80.0
    }
};

const SYSTEM_PRICES = [
    { kw: 2.28, phase: 1, msp: 176527, subsidy: 60000 },
    { kw: 3.42, phase: 1, msp: 222483, subsidy: 78000 },
    { kw: 4.56, phase: 1, msp: 277151, subsidy: 78000 },
    { kw: 5.13, phase: 1, msp: 317552, subsidy: 78000 },
    { kw: 5.13, phase: 3, msp: 343688, subsidy: 78000 },
    { kw: 6.27, phase: 3, msp: 392693, subsidy: 78000 },
    { kw: 8.55, phase: 3, msp: 496475, subsidy: 78000 },
    { kw: 9.69, phase: 3, msp: 560508, subsidy: 78000 }
];

interface BillBreakdown {
    total: number;
    fixed: number;
    energy: number;
    duty: number;
    rent: number;
    surcharge: number;
    fcSubsidy: number;
    ecSubsidy: number;
    slabs: { units: number; rate: number; cost: number }[];
    type: "Telescopic" | "Non-Telescopic";
}

function calculateKSEBBillDetailed(
    totalUnits: number, 
    phase: 1 | 3, 
    months: 1 | 2 = 1,
    tod?: { normal: number; peak: number; offPeak: number }
): BillBreakdown {
    let energy = 0;
    let fixed = 0;
    let slabs: { units: number; rate: number; cost: number }[] = [];
    let type: "Telescopic" | "Non-Telescopic" = "Telescopic";

    const units = totalUnits / months;

    if (units <= 250) {
        type = "Telescopic";
        if (units > 0) {
            let u1 = Math.min(units, 50);
            energy += u1 * 3.35;
            slabs.push({ units: u1 * months, rate: 3.35, cost: (u1 * 3.35) * months });
        }
        if (units > 50) {
            let u2 = Math.min(units - 50, 50);
            energy += u2 * 4.25;
            slabs.push({ units: u2 * months, rate: 4.25, cost: (u2 * 4.25) * months });
        }
        if (units > 100) {
            let u3 = Math.min(units - 100, 50);
            energy += u3 * 5.35;
            slabs.push({ units: u3 * months, rate: 5.35, cost: (u3 * 5.35) * months });
        }
        if (units > 150) {
            let u4 = Math.min(units - 150, 50);
            energy += u4 * 7.20;
            slabs.push({ units: u4 * months, rate: 7.20, cost: (u4 * 7.20) * months });
        }
        if (units > 200) {
            let u5 = Math.min(units - 200, 50);
            energy += u5 * 8.50;
            slabs.push({ units: u5 * months, rate: 8.50, cost: (u5 * 8.50) * months });
        }

        if (units <= 50) fixed = phase === 1 ? 50 : 130;
        else if (units <= 100) fixed = phase === 1 ? 85 : 175;
        else if (units <= 150) fixed = phase === 1 ? 105 : 205;
        else if (units <= 200) fixed = phase === 1 ? 140 : 215;
        else fixed = phase === 1 ? 160 : 235;

    } else {
        type = "Non-Telescopic";
        let rate = 0;
        if (units <= 300) {
            rate = 6.75;
            fixed = phase === 1 ? 220 : 240;
        } else if (units <= 350) {
            rate = 7.60;
            fixed = phase === 1 ? 240 : 250;
        } else if (units <= 400) {
            rate = 7.95;
            fixed = phase === 1 ? 260 : 260;
        } else if (units <= 500) {
            rate = 8.25;
            fixed = phase === 1 ? 286 : 285;
        } else {
            rate = 9.20;
            fixed = phase === 1 ? 310 : 310;
        }
        energy = units * rate;
        
        if (tod) {
            // TOD Logic: multipliers apply to the base energy rate
            const totalNormal = tod.normal;
            const totalPeak = tod.peak;
            const totalOffPeak = tod.offPeak;
            
            const costNormal = totalNormal * rate;
            const costPeak = totalPeak * (rate * 1.25);
            const costOffPeak = totalOffPeak * (rate * 0.90);
            
            energy = (costNormal + costPeak + costOffPeak) / months;
            slabs = [
                { units: totalNormal, rate, cost: costNormal },
                { units: totalPeak, rate: rate * 1.25, cost: costPeak },
                { units: totalOffPeak, rate: rate * 0.90, cost: costOffPeak }
            ];
        } else {
            slabs.push({ units: units * months, rate, cost: energy * months });
        }
    }

    const totalEnergy = energy * months;
    const totalFixed = fixed * months;
    const duty = Math.floor(totalEnergy * 0.10 * 10) / 10; // KSEB Duty is usually floor to 1 decimal
    const rent = (phase === 1 ? 6 : 15) * months;
    const surcharge = (units <= 40) ? 0 : (totalUnits * 0.01);

    // Subsidy Logic (Bimonthly only, <= 240 units)
    // Note: EC subsidy applies only on units exceeding 24 units
    let fcSubsidy = 0;
    let ecSubsidy = 0;
    if (months === 2 && totalUnits <= 240) {
        const subsidizableUnits = Math.max(0, totalUnits - 24);
        if (phase === 1) {
            fcSubsidy = 40;
            if (totalUnits >= 41 && totalUnits <= 52) ecSubsidy = subsidizableUnits * 1.5;
            else if (totalUnits >= 53 && totalUnits <= 80) ecSubsidy = subsidizableUnits * 0.35;
            else if (totalUnits >= 81 && totalUnits <= 240) ecSubsidy = subsidizableUnits * 0.5;
        } else if (phase === 3) {
            if (totalUnits >= 123 && totalUnits <= 147) ecSubsidy = subsidizableUnits * 2.4;
            else if (totalUnits >= 148 && totalUnits <= 240) ecSubsidy = subsidizableUnits * 0.5;
        }
    }

    return { 
        total: (totalEnergy + totalFixed + duty + rent + surcharge) - (fcSubsidy + ecSubsidy), 
        fixed: totalFixed, 
        energy: totalEnergy, 
        duty,
        rent,
        surcharge,
        fcSubsidy,
        ecSubsidy,
        slabs, 
        type 
    };
}

function calculateKSEBBill(units: number, phase: 1 | 3, months: 1 | 2 = 1, tod?: { normal: number; peak: number; offPeak: number }): number {
    return calculateKSEBBillDetailed(units, phase, months, tod).total;
}

function estimateUnitsFromBill(targetBill: number, phase: 1 | 3, months: 1 | 2 = 1): number {
    const minBill = calculateKSEBBill(0, phase, months);
    if (targetBill <= minBill) return 0;

    let low = 0;
    let high = 5000; // Assume max 5000 units for domestic
    for (let i = 0; i < 50; i++) {
        let mid = (low + high) / 2;
        let bill = calculateKSEBBill(mid, phase, months);
        if (Math.abs(bill - targetBill) < 0.1) return mid;
        if (bill < targetBill) low = mid;
        else high = mid;
    }
    return (low + high) / 2;
}

class DashboardApp {
    private currentPanel: "580" | "630" = "580";
    private currentPhase: 1 | 3 = 1;
    private currentCycle: 1 | 2 = 1;
    private billValue = 5000;
    private roofValue = 500;
    private sunValue = 5.0;
    private roiChart: any = null;

    init() {
        this.bindEvents();
        this.calculateAndRender();
    }

    bindEvents() {
        // Navigation Routing
        document.querySelectorAll('.nav-link[data-target]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
                const target = e.currentTarget as HTMLElement;
                target.classList.add('active');
                
                const targetId = target.dataset.target;
                document.querySelectorAll('.page-view').forEach(p => (p as HTMLElement).style.display = 'none');
                document.getElementById(`view-${targetId}`)!.style.display = 'block';
            });
        });

        // Bill Calculator Logic
        document.querySelectorAll('#calc-tod-toggle .toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = (e.currentTarget as HTMLElement);
                const isTod = target.dataset.tod === 'true';
                document.getElementById('calc-normal-inputs')!.style.display = isTod ? 'none' : 'block';
                document.getElementById('calc-tod-inputs')!.style.display = isTod ? 'block' : 'none';
            });
        });

        document.getElementById('btn-calc-bill')?.addEventListener('click', () => {
            const isTod = document.querySelector('#calc-tod-toggle .toggle-btn.active')?.getAttribute('data-tod') === 'true';
            
            let units = 0;
            let todData = undefined;

            if (isTod) {
                const n = parseFloat((document.getElementById('tod-normal') as HTMLInputElement).value) || 0;
                const p = parseFloat((document.getElementById('tod-input-peak') as HTMLInputElement).value) || 0;
                const o = parseFloat((document.getElementById('tod-input-offpeak') as HTMLInputElement).value) || 0;
                units = n + p + o;
                todData = { normal: n, peak: p, offPeak: o };
            } else {
                units = parseFloat((document.getElementById('calc-units') as HTMLInputElement).value) || 0;
            }
            
            const activePhaseBtn = document.querySelector('#calc-phase-toggle .toggle-btn.active') as HTMLElement;
            const phase = parseInt(activePhaseBtn.dataset.phase as string) as 1 | 3;

            const activeCycleBtn = document.querySelector('#calc-cycle-toggle .toggle-btn.active') as HTMLElement;
            const months = parseInt(activeCycleBtn.dataset.cycle as string) as 1 | 2;
            
            const breakdown = calculateKSEBBillDetailed(units, phase, months, todData);
            
            // Rounding logic for clean UI
            const roundedTotal = Math.round(breakdown.total);

            document.getElementById('cb-energy')!.textContent = breakdown.energy.toFixed(2);
            document.getElementById('cb-fixed')!.textContent = breakdown.fixed.toFixed(2);
            document.getElementById('cb-total')!.textContent = roundedTotal.toFixed(2);
            document.getElementById('cb-type')!.textContent = breakdown.type;
            
            const tbody = document.getElementById('cb-breakdown');
            if (tbody) {
                tbody.innerHTML = '';
                breakdown.slabs.forEach(slab => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="text-align: left;">${slab.units.toFixed(0)}</td>
                        <td>${slab.rate.toFixed(2)}</td>
                        <td class="text-accent" style="font-weight: 600;">₹${slab.cost.toFixed(2)}</td>
                    `;
                    tbody.appendChild(tr);
                });

                // Add Fuel Surcharge Row
                const trSurcharge = document.createElement('tr');
                trSurcharge.style.borderTop = '1px solid var(--border-glass)';
                trSurcharge.innerHTML = `
                    <td style="text-align: left; padding-top: 1rem;">Fuel Surcharge</td>
                    <td style="padding-top: 1rem;">₹0.01/unit</td>
                    <td class="text-warning" style="font-weight: 600; padding-top: 1rem;">₹${surcharge.toFixed(2)}</td>
                `;
                tbody.appendChild(trSurcharge);

                // Add Fixed Charge Row
                const trFC = document.createElement('tr');
                trFC.innerHTML = `
                    <td style="text-align: left;">Fixed Charge</td>
                    <td></td>
                    <td class="text-warning" style="font-weight: 600;">₹${breakdown.fixed.toFixed(2)}</td>
                `;
                tbody.appendChild(trFC);
                
                // Add Duty Row
                const trDuty = document.createElement('tr');
                trDuty.innerHTML = `
                    <td style="text-align: left;">Duty (10% of EC)</td>
                    <td></td>
                    <td class="text-muted">₹${breakdown.duty.toFixed(2)}</td>
                `;
                tbody.appendChild(trDuty);

                // Add Rent Row
                const trRent = document.createElement('tr');
                trRent.innerHTML = `
                    <td style="text-align: left;">Meter Rent</td>
                    <td></td>
                    <td class="text-muted">₹${breakdown.rent.toFixed(2)}</td>
                `;
                tbody.appendChild(trRent);

                // Add Subsidies
                if (breakdown.fcSubsidy > 0) {
                    const trFCSub = document.createElement('tr');
                    trFCSub.innerHTML = `
                        <td style="text-align: left;">FC Subsidy</td>
                        <td></td>
                        <td class="text-success" style="font-weight: 600;">-₹${breakdown.fcSubsidy.toFixed(2)}</td>
                    `;
                    tbody.appendChild(trFCSub);
                }

                if (breakdown.ecSubsidy > 0) {
                    const trECSub = document.createElement('tr');
                    trECSub.innerHTML = `
                        <td style="text-align: left;">EC Subsidy</td>
                        <td></td>
                        <td class="text-success" style="font-weight: 600;">-₹${breakdown.ecSubsidy.toFixed(2)}</td>
                    `;
                    tbody.appendChild(trECSub);
                }

                // Add Final Total Row
                const trTotal = document.createElement('tr');
                trTotal.style.borderTop = '2px solid var(--accent-primary)';
                trTotal.innerHTML = `
                    <td style="text-align: left; font-weight: 700; padding-top: 1rem; font-size: 1.1rem;">Total Bill</td>
                    <td style="padding-top: 1rem;"></td>
                    <td class="text-success" style="font-weight: 700; padding-top: 1rem; font-size: 1.2rem;">₹${roundedTotal.toFixed(2)}</td>
                `;
                tbody.appendChild(trTotal);
            }
        });

        // Unit Estimator Logic
        document.querySelectorAll('#view-estimator .toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = (e.currentTarget as HTMLElement);
                const parent = target.parentElement;
                if (parent) {
                    parent.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                }
                target.classList.add('active');
            });
        });

        document.getElementById('btn-run-estimator')?.addEventListener('click', () => {
            const billInput = document.getElementById('est-bill-amount') as HTMLInputElement;
            const bill = parseFloat(billInput.value) || 0;
            
            const activePhaseBtn = document.querySelector('#est-phase-toggle .toggle-btn.active') as HTMLElement;
            const phase = parseInt(activePhaseBtn.dataset.phase as string) as 1 | 3;

            const activeCycleBtn = document.querySelector('#est-cycle-toggle .toggle-btn.active') as HTMLElement;
            const months = parseInt(activeCycleBtn.dataset.cycle as string) as 1 | 2;
            
            const units = estimateUnitsFromBill(bill, phase, months);
            
            document.getElementById('est-result-units')!.textContent = Math.round(units).toString();
        });

        // Bill Calculator Toggle Logic
        document.querySelectorAll('#view-calculator .toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = (e.currentTarget as HTMLElement);
                const parent = target.parentElement;
                if (parent) {
                    parent.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                }
                target.classList.add('active');
            });
        });

        // Dashboard Toggles
        document.querySelectorAll('#view-dashboard .toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = (e.currentTarget as HTMLElement);
                const parent = target.parentElement;
                if (parent) {
                    parent.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                }
                target.classList.add('active');

                // Specific Dashboard Logic
                if (target.dataset.phase) {
                    this.currentPhase = parseInt(target.dataset.phase) as 1 | 3;
                }
                if (target.dataset.cycle) {
                    this.currentCycle = parseInt(target.dataset.cycle) as 1 | 2;
                }
                if (target.dataset.panel) {
                    this.currentPanel = target.dataset.panel as "580" | "630";
                    // Update warranty text
                    const panelData = PANELS[this.currentPanel];
                    document.getElementById('warranty-years')!.textContent = `${panelData.warrantyYears}-Year Performance Warranty`;
                    document.getElementById('warranty-desc')!.textContent = `Guaranteed ${panelData.endOutput}% output at year ${panelData.warrantyYears}.`;
                    document.getElementById('chart-years')!.textContent = panelData.warrantyYears.toString();
                }

                this.calculateAndRender();
            });
        });

        // Sliders
        const updateSlider = (id: string, valId: string, setter: (val: number) => void) => {
            const slider = document.getElementById(id) as HTMLInputElement;
            const valSpan = document.getElementById(valId);
            if (slider && valSpan) {
                slider.addEventListener('input', (e) => {
                    const val = parseFloat((e.target as HTMLInputElement).value);
                    setter(val);
                    valSpan.textContent = id === 'slider-bill' ? val.toLocaleString() : val.toString();
                    this.calculateAndRender();
                });
            }
        };

        updateSlider('slider-bill', 'val-bill', (v) => this.billValue = v);
        updateSlider('slider-roof', 'val-roof', (v) => this.roofValue = v);
        updateSlider('slider-sun', 'val-sun', (v) => this.sunValue = v);
    }

    calculateAndRender() {
        const panel = PANELS[this.currentPanel];
        
        // Update Labels
        const billLabel = document.getElementById('bill-label');
        if (billLabel) billLabel.textContent = this.currentCycle === 1 ? 'Monthly Electricity Bill' : 'Bimonthly Electricity Bill';
        
        const unitLabelSpan = document.getElementById('val-unit-label');
        const unitLabelStr = this.currentCycle === 1 ? 'Units/mo' : 'Units/2mo';
        if (unitLabelSpan) unitLabelSpan.textContent = unitLabelStr;

        // 1. Calculate how many units they consume based on their bill, phase and cycle
        const totalEnergyNeeded = estimateUnitsFromBill(this.billValue, this.currentPhase, this.currentCycle);
        const monthlyEnergyNeeded = totalEnergyNeeded / this.currentCycle;

        const unitsDisplay = document.getElementById('val-units');
        if (unitsDisplay) unitsDisplay.textContent = Math.round(totalEnergyNeeded).toString();
        
        // Phase Recommendation Alert
        const phaseAlert = document.getElementById('phase-alert');
        if (phaseAlert) {
            if (monthlyEnergyNeeded > 1000 && this.currentPhase === 1) {
                phaseAlert.style.display = 'block';
            } else {
                phaseAlert.style.display = 'none';
            }
        }

        // 2. System size needed to generate this energy
        const pr = 0.8;
        const kwNeeded = monthlyEnergyNeeded / (30 * this.sunValue * pr);
        
        // 3. Roof constraint
        const maxPanelsByRoof = Math.floor(this.roofValue / panel.areaSqFt);
        const maxKwByRoof = (maxPanelsByRoof * panel.power) / 1000;
        
        // 4. Select Best Standard System from Pricing Sheet
        // Filter by phase and roof limit
        const viableSystems = SYSTEM_PRICES.filter(s => s.phase === this.currentPhase && s.kw <= maxKwByRoof);
        
        // Find best match (closest to kwNeeded but within roof/phase limits)
        let selectedSystem = viableSystems.length > 0 ? viableSystems[0] : null;
        if (selectedSystem) {
            for (const s of viableSystems) {
                // If we need more than current, and current is bigger than what we have, pick it
                if (s.kw >= kwNeeded && (selectedSystem.kw < kwNeeded || s.kw < selectedSystem.kw)) {
                    selectedSystem = s;
                }
                // If we can't meet kwNeeded, pick the largest possible
                if (kwNeeded > selectedSystem.kw && s.kw > selectedSystem.kw) {
                    selectedSystem = s;
                }
            }
        }

        const actualKw = selectedSystem ? selectedSystem.kw : 0;
        const actualPanels = selectedSystem ? Math.ceil((selectedSystem.kw * 1000) / panel.power) : 0;
        
        // 5. Savings calculation using KSEB tariff
        const actualMonthlyEnergyGen = (actualKw * this.sunValue * pr * 30);
        
        // Calculate new bill based on net consumption
        const netUnitsMonthly = Math.max(0, monthlyEnergyNeeded - actualMonthlyEnergyGen);
        const newBillTotal = calculateKSEBBill(netUnitsMonthly * this.currentCycle, this.currentPhase, this.currentCycle);
        
        // Monthly Savings = Old Bill/mo - New Bill/mo
        const monthlyOldBill = this.billValue / this.currentCycle;
        const monthlyNewBill = newBillTotal / this.currentCycle;
        
        let monthlySavings = monthlyOldBill - monthlyNewBill;
        if (monthlySavings < 0) monthlySavings = 0;
        
        const annualSavings = monthlySavings * 12;
        
        // Financials from Price Sheet
        const systemMSP = selectedSystem ? selectedSystem.msp : 0;
        const systemSubsidy = selectedSystem ? selectedSystem.subsidy : 0;
        const netCost = systemMSP - systemSubsidy;
        
        const paybackYears = annualSavings > 0 ? (netCost / annualSavings) : 0;
        
        // 6. Environmental
        const annualKwh = actualMonthlyEnergyGen * 12;
        const co2OffsetTons = (annualKwh * 0.7) / 1000;
        const treesEquivalent = Math.round(co2OffsetTons * 45);
        
        // Update DOM
        document.getElementById('out-sys-size')!.textContent = actualKw.toFixed(2);
        document.getElementById('out-panels')!.textContent = actualPanels.toString();
        document.getElementById('out-savings-mo')!.textContent = Math.round(monthlySavings).toLocaleString();
        document.getElementById('out-savings-yr')!.textContent = Math.round(annualSavings).toLocaleString();
        document.getElementById('out-payback')!.textContent = paybackYears > 0 ? paybackYears.toFixed(1) : "0.0";
        document.getElementById('out-co2')!.textContent = co2OffsetTons.toFixed(1);
        document.getElementById('out-trees')!.textContent = treesEquivalent.toString();

        this.renderChart(netCost, annualSavings, panel.warrantyYears, panel.degYear1, panel.degYearly);
    }

    renderChart(cost: number, initialAnnualSavings: number, years: number, degYear1: number, degYearly: number) {
        const labels = [];
        const costData = [];
        const savingsData = [];
        
        let cumulativeCost = cost;
        let cumulativeSavings = 0;
        
        for (let i = 1; i <= years; i++) {
            labels.push(`Yr ${i}`);
            
            // Assume 5% inflation on utility bill per year
            const inflation = Math.pow(1.05, i - 1);
            
            // Calculate panel degradation for this year
            let efficiencyAtYear = 100;
            if (i > 1) {
                efficiencyAtYear = 100 - degYear1 - (degYearly * (i - 2));
            }
            
            // Savings this year (with degraded panel but inflated grid price)
            const savingsThisYear = initialAnnualSavings * (efficiencyAtYear / 100) * inflation;
            cumulativeSavings += savingsThisYear;
            savingsData.push(Math.round(cumulativeSavings));
            
            // What they would have paid utility
            // They pay whatever their bill is, inflated
            const utilityCostThisYear = (this.billValue * 12) * inflation;
            // cumulative cost is system cost + utility cost of whatever solar didn't cover
            cumulativeCost += (utilityCostThisYear - savingsThisYear > 0 ? utilityCostThisYear - savingsThisYear : 0);
            
            // For simple visualization, let's just plot Utility cumulative vs Solar Cumulative Savings
            // Actually, comparing "Do Nothing" (Cumulative Utility Bill) vs "Go Solar" (System Cost + Remaining Utility Bill)
        }

        // Let's refine the plot to be: "Cumulative Utility Bill" vs "Cumulative Solar Cost (System + Remaining Bill)"
        const cumulativeUtility = [];
        const cumulativeSolar = [];
        
        let sumUtility = 0;
        let sumSolar = cost; // Initial investment
        
        for (let i = 1; i <= years; i++) {
            const inflation = Math.pow(1.05, i - 1);
            
            let eff = 100;
            if (i === 1) eff = 100 - degYear1;
            else eff = 100 - degYear1 - (degYearly * (i - 1));
            
            const yearlyBill = this.billValue * 12 * inflation;
            sumUtility += yearlyBill;
            cumulativeUtility.push(Math.round(sumUtility));
            
            const solarGen = initialAnnualSavings * (eff / 100) * inflation;
            const remainingBill = Math.max(0, yearlyBill - solarGen);
            sumSolar += remainingBill;
            cumulativeSolar.push(Math.round(sumSolar));
        }

        const ctx = document.getElementById('roiChart') as HTMLCanvasElement;
        
        if (this.roiChart) {
            this.roiChart.destroy();
        }

        this.roiChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Do Nothing (Utility Cost)',
                        data: cumulativeUtility,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Go Solar (System + Remaining Bill)',
                        data: cumulativeSolar,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: false // We built a custom one in HTML
                    },
                    tooltip: {
                        backgroundColor: 'rgba(20, 20, 24, 0.9)',
                        titleFont: { family: 'Outfit', size: 14 },
                        bodyFont: { family: 'Outfit', size: 13 },
                        padding: 12,
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context: any) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#71717a', font: { family: 'Outfit' } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { 
                            color: '#71717a', 
                            font: { family: 'Outfit' },
                            callback: function(value: any) {
                                if (value >= 100000) return '₹' + (value / 100000).toFixed(1) + 'L';
                                return '₹' + value;
                            }
                        }
                    }
                }
            }
        });
    }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    const app = new DashboardApp();
    app.init();
});