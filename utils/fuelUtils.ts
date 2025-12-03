import { RocketPart, PartType } from "../types";

export const getChildrenMap = (parts: RocketPart[]) => {
    const map = new Map<string, RocketPart[]>();
    parts.forEach(p => {
        if (p.parentId) {
            if (!map.has(p.parentId)) map.set(p.parentId, []);
            map.get(p.parentId)!.push(p);
        }
    });
    return map;
}

export const isEngineBlockedByStage = (engine: RocketPart, childrenMap: Map<string, RocketPart[]>) => {
    // BFS downwards to see if there is a Stack Decoupler in the subtree.
    // If so, this engine is part of an upper stage and should not fire yet.
    const queue = [engine];
    while(queue.length > 0) {
        const curr = queue.shift()!;
        if (curr.type === PartType.DECOUPLER) {
             // Check if it's a stack decoupler (has stack nodes)
             // Note: Radial decouplers don't block main stack engines from firing.
             if (curr.nodes.some(n => n.type === 'stack')) return true;
        }
        const children = childrenMap.get(curr.instanceId) || [];
        children.forEach(c => queue.push(c));
    }
    return false;
}

export const findFuelSources = (
    engine: RocketPart, 
    allParts: RocketPart[], 
    childrenMap: Map<string, RocketPart[]>
): { part: RocketPart, dist: number }[] => {
    const isAnyDecoupler = (p: RocketPart) => p.type === PartType.DECOUPLER;

    const sources: { part: RocketPart, dist: number }[] = [];
    const queue: { part: RocketPart, dist: number }[] = [{ part: engine, dist: 0 }];
    const visited = new Set<string>();
    visited.add(engine.instanceId);

    // Self (Some engines might have internal fuel)
    if (engine.type === PartType.TANK || (engine.fuelCapacity || 0) > 0) {
         sources.push({ part: engine, dist: 0 });
    }

    while (queue.length > 0) {
        const { part: curr, dist } = queue.shift()!;
        
        // UP (Parent)
        if (curr.parentId) {
            const parent = allParts.find(p => p.instanceId === curr.parentId);
            if (parent) {
                // Rule: Block flow UPWARDS if we cross ANY decoupler.
                const blocked = isAnyDecoupler(curr) || isAnyDecoupler(parent);
                
                if (!blocked && !visited.has(parent.instanceId)) {
                    visited.add(parent.instanceId);
                    queue.push({ part: parent, dist: dist + 1 });
                    if (parent.type === PartType.TANK || (parent.fuelCapacity || 0) > 0) {
                        sources.push({ part: parent, dist: dist + 1 });
                    }
                }
            }
        }

        // DOWN (Children)
        const children = childrenMap.get(curr.instanceId) || [];
        children.forEach(child => {
            // Rule: Block flow DOWNWARDS if we cross ANY decoupler.
            // Strict isolation: Fuel cannot flow through decouplers (no crossfeed without fuel lines).
            const blocked = isAnyDecoupler(curr) || isAnyDecoupler(child);
            
            if (!blocked && !visited.has(child.instanceId)) {
                visited.add(child.instanceId);
                queue.push({ part: child, dist: dist + 1 });
                if (child.type === PartType.TANK || (child.fuelCapacity || 0) > 0) {
                    sources.push({ part: child, dist: dist + 1 });
                }
            }
        });
    }
    
    return sources;
};
