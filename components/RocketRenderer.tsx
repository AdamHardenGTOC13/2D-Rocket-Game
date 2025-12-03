import React, { useRef, useEffect, useState } from 'react';
import { RocketPart } from '../types';
import { calculateRocketLayout, getRocketBounds, hitTest, PartWithPosition, SCALE } from '../utils/rocketUtils';
import { drawPartShape, getPartStyle, setupCanvas } from '../utils/renderUtils';

interface RocketRendererProps {
  parts: RocketPart[];
  layout?: PartWithPosition[]; // Optional pre-calculated layout optimization
  scale?: number;
  ghostPart?: RocketPart | null;
  ghostPosition?: { x: number, y: number };
  onPartClick?: (partId: string) => void;
  onPartContextMenu?: (partId: string) => void;
  onPartHover?: (partId: string | null, clientX: number, clientY: number) => void;
  isDeleteMode?: boolean;
}

export const RocketRenderer: React.FC<RocketRendererProps> = ({ 
  parts, 
  layout: providedLayout,
  scale = 1, 
  ghostPart, 
  ghostPosition,
  onPartClick,
  onPartContextMenu,
  onPartHover,
  isDeleteMode = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null);

  // Use provided layout or calculate internally
  const layout = providedLayout || calculateRocketLayout(parts);
  const bounds = getRocketBounds(layout);

  // Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Resize canvas to fit container
    const { clientWidth, clientHeight } = container;
    const ctx = setupCanvas(canvas, clientWidth, clientHeight);
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, clientWidth, clientHeight);

    // Calculate Viewport Transform
    // ViewBox Center (vbX + vbW/2) should map to Canvas Center
    // Scale is applied to the viewBox dimensions in SVG terms.
    // Here we construct the matrix directly.
    
    const centerX = clientWidth / 2;
    const centerY = clientHeight / 2;
    
    // We want the point (bounds.cX, bounds.cY) to be at (centerX, centerY)
    // And scaled by 'scale'.
    
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);
    ctx.translate(-bounds.cX, -bounds.cY);

    // Render Parts
    layout.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        // Flip for radial symmetry on left side
        if (p.radialOffset === -1) {
            ctx.scale(-1, 1);
        }

        const width = p.width * SCALE;
        const height = p.height * SCALE;
        const style = getPartStyle(p.type);

        ctx.fillStyle = style.fill;
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 2;

        // Pass deployed state (defaults to false if undefined)
        drawPartShape(ctx, p.type, width, height, p.isDeployed);
        ctx.fill();
        ctx.stroke();

        // Highlight for Delete/Hover
        if (hoveredPartId === p.instanceId) {
            const highlightColor = isDeleteMode ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.2)';
            ctx.fillStyle = highlightColor;
            ctx.fill(); // Fill over the existing shape
        }

        ctx.restore();
    });

    // Render Ghost Part
    if (ghostPart && ghostPosition) {
        ctx.save();
        ctx.translate(ghostPosition.x, ghostPosition.y);
        
        // Ghost rotation/scale assumptions? 
        // For now assume standard orientation or pass it down. 
        // The dragging logic usually keeps rotation 0 unless snapped.
        // We will just draw it upright or based on context if we had it.
        
        const width = ghostPart.width * SCALE;
        const height = ghostPart.height * SCALE;
        const style = getPartStyle(ghostPart.type, true);

        ctx.fillStyle = style.fill;
        ctx.strokeStyle = style.stroke;
        if (style.dashed) ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;

        drawPartShape(ctx, ghostPart.type, width, height, false);
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();
    }

    ctx.restore();

  }, [layout, bounds, scale, ghostPart, ghostPosition, hoveredPartId, isDeleteMode]);

  // Interaction Handlers
  const getMouseWorldPos = (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;
      
      const width = rect.width;
      const height = rect.height;
      const centerX = width / 2;
      const centerY = height / 2;

      // Inverse Transform
      // Screen = (World - BoundC) * Scale + Center
      // World = (Screen - Center) / Scale + BoundC
      
      const worldX = (clientX - centerX) / scale + bounds.cX;
      const worldY = (clientY - centerY) / scale + bounds.cY;
      
      return { x: worldX, y: worldY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      // Always do hit testing if onPartHover is present, OR if interact handlers are present
      if (!onPartClick && !onPartContextMenu && !onPartHover) return;

      const { x, y } = getMouseWorldPos(e);
      const hitId = hitTest(layout, x, y);
      
      if (hitId !== hoveredPartId) {
          setHoveredPartId(hitId);
      }
      
      if (onPartHover) {
          onPartHover(hitId, e.clientX, e.clientY);
      }
  };

  const handleClick = (e: React.MouseEvent) => {
      if (onPartClick && hoveredPartId) {
          onPartClick(hoveredPartId);
      }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
      if (onPartContextMenu && hoveredPartId) {
          e.preventDefault();
          onPartContextMenu(hoveredPartId);
      }
  };
  
  const handleMouseLeave = () => {
      setHoveredPartId(null);
      if (onPartHover) onPartHover(null, 0, 0);
  };

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`block w-full h-full ${onPartClick ? 'cursor-pointer' : ''}`}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
};