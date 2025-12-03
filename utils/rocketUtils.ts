import { RocketPart, AttachNode } from "../types";

export interface PartWithPosition extends RocketPart {
  x: number; // World X (relative to rocket root)
  y: number; // World Y
  rotation: number; // Radians
}

export interface RenderableNode {
  partInstanceId: string;
  nodeId: string;
  x: number; // World X
  y: number; // World Y
  type: 'stack' | 'radial';
  occupied: boolean;
}

// 50 pixels per meter
export const SCALE = 50; 

const getEffectiveX = (part: RocketPart, x: number) => {
    const offset = part.radialOffset || 1;
    return offset === -1 ? -x : x;
};

// Calculates the world position of all parts in the rocket tree
export const calculateRocketLayout = (parts: RocketPart[]): PartWithPosition[] => {
  if (parts.length === 0) return [];

  // Find root (part with no parent) - Usually Command Pod
  // Note: Drag-drop system might allow multiple roots temporarily, but for now assume one
  const root = parts.find(p => !p.parentId);
  if (!root) return [];

  const layout: PartWithPosition[] = [];
  const queue: { part: RocketPart, x: number, y: number, r: number }[] = [
    { part: root, x: 0, y: 0, r: 0 }
  ];

  while (queue.length > 0) {
    const { part, x, y, r } = queue.shift()!;
    
    // Add to layout
    layout.push({ ...part, x, y, rotation: r });

    // Find children
    const children = parts.filter(p => p.parentId === part.instanceId);
    
    children.forEach(child => {
       // Find the connection nodes
       const parentNode = part.nodes.find(n => n.id === child.parentNodeId);
       
       if (!parentNode) return;

       let childNodeId = 'top'; // Default
       
       if (parentNode.id === 'bottom') {
           childNodeId = 'top';
       } else if (parentNode.id === 'top') {
           childNodeId = 'bottom';
       } else if (['left', 'right', 'attach'].includes(parentNode.id)) {
           // Radial connections
           // If attaching to a radial node, we usually attach the 'inner' side of the child.
           // For decouplers, that's 'root'. For tanks/boosters, that's 'left'.
           // Because we handle mirroring via getEffectiveX, we don't need to swap 'left'/'right' IDs manually.
           if (child.type === 'DECOUPLER') childNodeId = 'root'; 
           else childNodeId = 'left';
       }

       const childNode = child.nodes.find(n => n.id === childNodeId) || child.nodes[0];
       
       const pNodeX = getEffectiveX(part, parentNode.x) * SCALE;
       const pNodeY = parentNode.y * SCALE;
       const cNodeX = getEffectiveX(child, childNode.x) * SCALE;
       const cNodeY = childNode.y * SCALE;

       const newX = x + pNodeX - cNodeX;
       const newY = y + pNodeY - cNodeY;
       
       queue.push({ part: child, x: newX, y: newY, r: 0 });
    });
  }

  return layout;
};

// Returns all OPEN nodes in world coordinates for hit testing
export const getAvailableNodes = (layout: PartWithPosition[], allParts: RocketPart[]): RenderableNode[] => {
    const nodes: RenderableNode[] = [];

    layout.forEach(placedPart => {
        placedPart.nodes.forEach(node => {
            // Check if occupied
            const isOccupied = allParts.some(p => p.parentId === placedPart.instanceId && p.parentNodeId === node.id);
            
            if (!isOccupied) {
                // Respect mirroring for node position
                const effX = getEffectiveX(placedPart, node.x);
                
                nodes.push({
                    partInstanceId: placedPart.instanceId,
                    nodeId: node.id,
                    x: placedPart.x + effX * SCALE,
                    y: placedPart.y + node.y * SCALE,
                    type: node.type,
                    occupied: false
                });
            }
        });
    });

    return nodes;
};

export const getRocketBounds = (layout: PartWithPosition[], padding = 100) => {
   if (layout.length === 0) return { minX: -200, maxX: 200, minY: -100, maxY: 400, width: 400, height: 500, cX: 0, cY: 150 };
   
   const minX = Math.min(...layout.map(p => p.x - (p.width*SCALE)/2));
   const maxX = Math.max(...layout.map(p => p.x + (p.width*SCALE)/2));
   const minY = Math.min(...layout.map(p => p.y - (p.height*SCALE)/2));
   const maxY = Math.max(...layout.map(p => p.y + (p.height*SCALE)/2));
   
   // Enforce a minimum size so zooming in doesn't break on single small parts
   const realW = maxX - minX;
   const realH = maxY - minY;
   const safeW = Math.max(realW, 200);
   const safeH = Math.max(realH, 300);

   const cX = (minX + maxX) / 2;
   const cY = (minY + maxY) / 2;

   return {
       minX: cX - safeW/2 - padding,
       maxX: cX + safeW/2 + padding,
       minY: cY - safeH/2 - padding,
       maxY: cY + safeH/2 + padding,
       width: safeW + padding * 2,
       height: safeH + padding * 2,
       cX,
       cY
   };
};

export const hitTest = (layout: PartWithPosition[], worldX: number, worldY: number): string | null => {
    // Iterate in reverse (top-most first)
    for (let i = layout.length - 1; i >= 0; i--) {
        const p = layout[i];
        
        // Inverse transform: World -> Local
        const dx = worldX - p.x;
        const dy = worldY - p.y;
        
        // Rotate backwards
        const cos = Math.cos(-p.rotation);
        const sin = Math.sin(-p.rotation);
        
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;
        
        const w = p.width * SCALE;
        const h = p.height * SCALE;
        
        // Check bounds
        if (localX >= -w/2 && localX <= w/2 && localY >= -h/2 && localY <= h/2) {
            return p.instanceId;
        }
    }
    return null;
};