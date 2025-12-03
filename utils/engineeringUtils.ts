
import { RocketPart, PartType } from "../types";

export interface StageStats {
    stageIndex: number; // 0 is root/payload, higher is lower/booster
    deltaV: number; // m/s
    twr: number; // Thrust to Weight Ratio
    burnTime: number; // seconds
    startMass: number; // kg
    endMass: number; // kg
    thrust: number; // N
    isp: number; // s
    wetMass: number; // Mass of this stage only (wet)
    dryMass: number; // Mass of this stage only (dry)
    partCount: number;
}

const G0 = 9.81;

export const calculateEngineeringStats = (parts: RocketPart[]): StageStats[] => {
    if (parts.length === 0) return [];

    // 1. Assign Stages via BFS/Tree Traversal
    // Structural Staging: Root is Stage 0. Decouplers increment stage index for their children.
    const partStageMap = new Map<string, number>();
    const root = parts.find(p => !p.parentId);
    if (!root) return [];
    
    let maxStage = 0;
    const queue: { part: RocketPart, stage: number }[] = [{ part: root, stage: 0 }];
    
    while(queue.length > 0) {
        const { part, stage } = queue.shift()!;
        partStageMap.set(part.instanceId, stage);
        maxStage = Math.max(maxStage, stage);
        
        const children = parts.filter(p => p.parentId === part.instanceId);
        children.forEach(child => {
            // If the PARENT is a decoupler, the child starts a new structural stage
            let nextStage = stage;
            if (part.type === PartType.DECOUPLER) {
                nextStage = stage + 1;
            }
            queue.push({ part: child, stage: nextStage });
        });
    }

    const stats: StageStats[] = [];

    // 2. Calculate Stats per Stage (Iterating from Bottom/Boosters up to Payload)
    // Assumption: Sequential Staging. Stage N lifts Stage N...0.
    for (let s = maxStage; s >= 0; s--) {
        const stageParts = parts.filter(p => partStageMap.get(p.instanceId) === s);
        
        // Payload = All parts with stage index < s
        const payloadParts = parts.filter(p => (partStageMap.get(p.instanceId) || 0) < s);
        const payloadMass = payloadParts.reduce((sum, p) => sum + p.mass + (p.currentFuel || 0), 0);
        
        const stageDryMassOnly = stageParts.reduce((sum, p) => sum + p.mass, 0);
        const stageFuel = stageParts.reduce((sum, p) => sum + (p.currentFuel || 0), 0);
        const stageWetMassOnly = stageDryMassOnly + stageFuel;
        
        const startMass = payloadMass + stageWetMassOnly;
        const endMass = payloadMass + stageDryMassOnly;

        // Engines
        const engines = stageParts.filter(p => p.type === PartType.ENGINE);
        let totalThrust = 0;
        let totalBurnRate = 0;
        
        engines.forEach(eng => {
             // Check obstruction within the same stage (simple check)
             // In complex builds, we might check if a decoupler is immediately below, 
             // but here we assume all engines in the stage contribute unless obstructed by non-decouplers
             totalThrust += (eng.thrust || 0);
             totalBurnRate += (eng.burnRate || 0);
        });

        let isp = 0;
        let deltaV = 0;
        let burnTime = 0;
        let twr = 0;

        if (totalThrust > 0 && totalBurnRate > 0) {
            // Weighted Isp
            // Isp = TotalThrust / (TotalMassFlow * g)
            isp = totalThrust / (totalBurnRate * G0);
            
            // Rocket Equation: dV = Isp * g * ln(m0 / m1)
            // Clamp log to avoid -Infinity if masses are 0 (unlikely)
            if (startMass > 0 && endMass > 0) {
                deltaV = isp * G0 * Math.log(startMass / endMass);
            }
            
            burnTime = stageFuel / totalBurnRate;
            
            // TWR at sea level (start)
            twr = totalThrust / (startMass * G0);
        }

        stats.push({
            stageIndex: s,
            deltaV,
            twr,
            burnTime,
            startMass,
            endMass,
            thrust: totalThrust,
            isp,
            wetMass: stageWetMassOnly,
            dryMass: stageDryMassOnly,
            partCount: stageParts.length
        });
    }

    // Return ordered from Bottom (Launch) to Top
    return stats;
};
