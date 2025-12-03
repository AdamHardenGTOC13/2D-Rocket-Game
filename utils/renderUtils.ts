import { PartType } from '../types';

export const drawPartShape = (ctx: CanvasRenderingContext2D, type: PartType, w: number, h: number, isDeployed: boolean = false) => {
    const hw = w / 2;
    const hh = h / 2;
    ctx.beginPath();
    switch (type) {
        case PartType.NOSE:
            // Curved nose cone
            ctx.moveTo(-hw, hh);
            ctx.quadraticCurveTo(0, -h * 1.5, hw, hh);
            ctx.closePath();
            break;
        case PartType.PARACHUTE:
            // Parachute Pack
            ctx.moveTo(-hw, hh);
            ctx.lineTo(hw, hh);
            ctx.lineTo(hw * 0.8, -hh * 0.2);
            ctx.quadraticCurveTo(0, -hh * 0.8, -hw * 0.8, -hh * 0.2);
            ctx.closePath();
            
            // Deployed Canopy
            if (isDeployed) {
                ctx.fill(); // Fill the pack first
                ctx.stroke();
                
                ctx.beginPath();
                const lineLen = h * 8;
                const canopyW = w * 10;
                const canopyH = h * 6;
                
                // Lines
                ctx.moveTo(0, -hh);
                ctx.lineTo(-canopyW/2 + canopyW*0.1, -lineLen);
                ctx.moveTo(0, -hh);
                ctx.lineTo(canopyW/2 - canopyW*0.1, -lineLen);
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1;
                ctx.stroke();
                
                // Canopy
                ctx.beginPath();
                ctx.arc(0, -lineLen, canopyW/2, Math.PI, 0); // Semi-circle
                ctx.quadraticCurveTo(0, -lineLen - canopyH*0.2, -canopyW/2, -lineLen);
                ctx.fillStyle = '#orange';
                ctx.fillStyle = '#fbbf24'; // Amber canopy
                ctx.fill();
                ctx.strokeStyle = '#d97706';
                ctx.stroke();
                
                // Return to normal context for subsequent strokes (though caller handles restore)
                return; 
            }
            break;
        case PartType.COMMAND:
             // Capsule shape
            ctx.moveTo(-hw, hh);
            ctx.lineTo(hw, hh);
            ctx.lineTo(hw * 0.7, -hh * 0.5);
            ctx.quadraticCurveTo(0, -hh * 1.2, -hw * 0.7, -hh * 0.5);
            ctx.closePath();
            break;
        case PartType.TANK:
        case PartType.DECOUPLER:
            if (type === PartType.DECOUPLER) {
                 // Slight bevel for decouplers
                 ctx.rect(-hw, -hh, w, h);
            } else {
                 // Rounded corners for tanks
                 const r = w * 0.1;
                 ctx.roundRect(-hw, -hh, w, h, r);
            }
            break;
        case PartType.ENGINE:
            // Realistic Engine Nozzle
            const pumpH = h * 0.3; // Height of the turbopump assembly at top
            const topW = w * 0.7; // Width of top assembly
            const throatW = w * 0.25; // Narrowest point of nozzle

            // Top Assembly (Turbopumps/Mount)
            ctx.moveTo(-topW / 2, -hh);
            ctx.lineTo(topW / 2, -hh);
            ctx.lineTo(topW / 2, -hh + pumpH);
            
            // Bell Nozzle Right
            // Curve in to throat, then out to rim
            ctx.bezierCurveTo(
                throatW * 0.8, -hh + pumpH + h * 0.1, // Control 1 (inward pinch)
                w * 0.6, hh * 0.6,                 // Control 2 (outward flair)
                hw, hh                              // End point (bottom right)
            );

            // Bottom Rim
            ctx.lineTo(-hw, hh);

            // Bell Nozzle Left
            ctx.bezierCurveTo(
                -w * 0.6, hh * 0.6,                // Control 1 (mirror)
                -throatW * 0.8, -hh + pumpH + h * 0.1, // Control 2 (mirror)
                -topW / 2, -hh + pumpH             // End point
            );
            
            ctx.closePath();
            break;
        case PartType.FIN:
            ctx.moveTo(-hw, hh); 
            ctx.lineTo(hw, hh*0.5); 
            ctx.lineTo(hw, -hh); 
            ctx.closePath();
            break;
        case PartType.STRUCTURAL:
            // Truss / Girder
            ctx.rect(-hw, -hh, w, h);
            // X bracing
            ctx.moveTo(-hw, -hh);
            ctx.lineTo(hw, hh);
            ctx.moveTo(hw, -hh);
            ctx.lineTo(-hw, hh);
            break;
        case PartType.LEG:
            // Housing
            ctx.rect(-hw, -hh, w/2, h/2);
            // Leg
            ctx.moveTo(-hw + w/4, -hh + h/4);
            ctx.lineTo(hw, hh); // Extended leg
            ctx.lineTo(hw - w/4, hh); // Foot
            break;
        default:
            ctx.rect(-hw, -hh, w, h);
    }
};

export const getPartStyle = (type: PartType, isGhost: boolean = false) => {
    if (isGhost) {
        return { fill: 'rgba(34, 211, 238, 0.2)', stroke: '#22d3ee', dashed: true };
    }
    
    switch (type) {
        case PartType.NOSE:
            return { fill: '#cbd5e1', stroke: '#475569' };
        case PartType.COMMAND:
            return { fill: '#e2e8f0', stroke: '#1e293b' };
        case PartType.TANK:
            return { fill: '#f8fafc', stroke: '#64748b' };
        case PartType.ENGINE:
            return { fill: '#334155', stroke: '#020617' }; 
        case PartType.DECOUPLER:
            return { fill: '#facc15', stroke: '#ca8a04' };
        case PartType.FIN:
            return { fill: '#3b82f6', stroke: '#1e3a8a' };
        case PartType.STRUCTURAL:
            return { fill: '#94a3b8', stroke: '#334155' };
        case PartType.LEG:
            return { fill: '#1f2937', stroke: '#000000' };
        case PartType.PARACHUTE:
            return { fill: '#ffffff', stroke: '#f59e0b' };
        default:
            return { fill: '#94a3b8', stroke: '#475569' };
    }
};

export const setupCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
    return ctx;
};