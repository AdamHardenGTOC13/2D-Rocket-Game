import React, { useState, useRef, useMemo } from 'react';
import { RocketPart, RocketPartDef, PartType } from '../types';
import { AVAILABLE_PARTS } from '../constants';
import { RocketRenderer } from './RocketRenderer';
import { Plus, Trash2, Rocket, RotateCcw, BrainCircuit, Columns, Info, MousePointer2, Eraser, Calculator, AlertTriangle, Download, Upload, Fuel, Gauge, Wind, Layers } from 'lucide-react';
import { analyzeMission } from '../services/geminiService';
import { calculateRocketLayout, getAvailableNodes, SCALE, getRocketBounds } from '../utils/rocketUtils';
import { calculateEngineeringStats, assignStages } from '../utils/engineeringUtils';

interface BuilderProps {
  parts: RocketPart[];
  onPartsChange: (parts: RocketPart[]) => void;
  onLaunch: () => void;
}

export const Builder: React.FC<BuilderProps> = ({ parts, onPartsChange, onLaunch }) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [symmetryMode, setSymmetryMode] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [showEngineering, setShowEngineering] = useState(true);
  const [zoom, setZoom] = useState(1);

  // Hover Tooltip State for Sidebar Parts
  const [hoveredInfo, setHoveredInfo] = useState<{ part: RocketPartDef, top: number } | null>(null);

  // Hover Tooltip State for Placed Parts
  const [hoveredPlacedInfo, setHoveredPlacedInfo] = useState<{ id: string, x: number, y: number } | null>(null);

  // Dragging State
  const [draggedDef, setDraggedDef] = useState<RocketPartDef | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [snapNode, setSnapNode] = useState<{ partInstanceId: string, nodeId: string, x: number, y: number } | null>(null);

  // Computed layout for hit testing
  const layout = useMemo(() => calculateRocketLayout(parts), [parts]);
  const availableNodes = useMemo(() => getAvailableNodes(layout, parts), [layout, parts]);
  const bounds = useMemo(() => getRocketBounds(layout), [layout]);
  
  // Engineering Stats
  const stageStats = useMemo(() => calculateEngineeringStats(parts), [parts]);
  const partStageMap = useMemo(() => assignStages(parts), [parts]);
  const totalDeltaV = stageStats.reduce((sum, s) => sum + s.deltaV, 0);

  const handleWheel = (e: React.WheelEvent) => {
      setZoom(prev => {
          const newZoom = prev - e.deltaY * 0.001;
          return Math.max(0.2, Math.min(newZoom, 5));
      });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    
    // Accurate mapping from Screen Pixels to World Coordinates
    // This logic must match RocketRenderer's internal transform
    const rect = containerRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    // Inverse Transform: World = (Screen - Center) / Scale + BoundC
    const worldX = (relX - centerX) / zoom + bounds.cX;
    const worldY = (relY - centerY) / zoom + bounds.cY;
    
    setMousePos({ x: worldX, y: worldY });

    if (!draggedDef) return;

    // Check Snapping
    let bestDist = 40; // Snap radius
    let bestNode = null;

    availableNodes.forEach(node => {
        const dx = worldX - node.x;
        const dy = worldY - node.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist < bestDist) {
            bestDist = dist;
            bestNode = node;
        }
    });
    
    setSnapNode(bestNode);
  };

  const handlePlacedPartHover = (id: string | null, clientX: number, clientY: number) => {
      if (id) {
          setHoveredPlacedInfo({ id, x: clientX, y: clientY });
      } else {
          setHoveredPlacedInfo(null);
      }
  };

  const handlePartDrop = () => {
     if (!draggedDef) return;

     if (parts.length === 0) {
         if (draggedDef.type !== PartType.COMMAND) {
             alert("Start with a Command Pod!");
             setDraggedDef(null);
             return;
         }
         const newPart: RocketPart = {
             ...draggedDef,
             instanceId: Math.random().toString(36).substr(2, 9),
             currentFuel: draggedDef.fuelCapacity,
             nodes: draggedDef.nodes // carry over def nodes
         };
         onPartsChange([newPart]);
     } else if (snapNode) {
         // Attach to node
         const parent = parts.find(p => p.instanceId === snapNode.partInstanceId);
         if (!parent) return;

         const newPartId = Math.random().toString(36).substr(2, 9);
         const symId = symmetryMode ? Math.random().toString(36).substr(2, 9) : undefined;
         
         let radialOffset = 1;
         if (snapNode.nodeId === 'left') {
             radialOffset = -1;
         } else if (snapNode.nodeId === 'right') {
             radialOffset = 1;
         } else if (parent.radialOffset) {
             radialOffset = parent.radialOffset;
         }

         const newPart: RocketPart = {
             ...draggedDef,
             instanceId: newPartId,
             currentFuel: draggedDef.fuelCapacity,
             parentId: parent.instanceId,
             parentNodeId: snapNode.nodeId,
             symmetryId: symId,
             radialOffset: radialOffset,
             nodes: draggedDef.nodes
         };

         const newParts = [newPart];

         // Symmetry Logic
         if (symmetryMode) {
             let mirrorNodeId = '';
             let mirrorParentId = parent.instanceId;

             if (snapNode.nodeId === 'right') mirrorNodeId = 'left';
             else if (snapNode.nodeId === 'left') mirrorNodeId = 'right';
             else {
                 if (parent.symmetryId) {
                     const mirrorParent = parts.find(p => p.symmetryId === parent.symmetryId && p.instanceId !== parent.instanceId);
                     if (mirrorParent) {
                         mirrorParentId = mirrorParent.instanceId;
                         mirrorNodeId = snapNode.nodeId; 
                     }
                 }
             }
             
             if (mirrorNodeId) {
                 const mirrorPart: RocketPart = {
                     ...draggedDef,
                     instanceId: Math.random().toString(36).substr(2, 9),
                     currentFuel: draggedDef.fuelCapacity,
                     parentId: mirrorParentId,
                     parentNodeId: mirrorNodeId,
                     symmetryId: symId,
                     radialOffset: radialOffset * -1,
                     nodes: draggedDef.nodes
                 };
                 newParts.push(mirrorPart);
             }
         }

         onPartsChange([...parts, ...newParts]);
     }

     setDraggedDef(null);
     setSnapNode(null);
  };

  const removePart = (id: string) => {
    const toDelete = new Set<string>();
    const stack = [id];
    while(stack.length > 0) {
        const curr = stack.pop()!;
        toDelete.add(curr);
        parts.filter(p => p.parentId === curr).forEach(child => stack.push(child.instanceId));
    }
    onPartsChange(parts.filter(p => !toDelete.has(p.instanceId)));
  };

  const handleGeminiAnalysis = async () => {
    if (parts.length === 0) return;
    setAnalyzing(true);
    try {
      const result = await analyzeMission(parts);
      setAnalysis(result);
    } catch (e) {
      alert("AI Analysis Failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = () => {
      const design = {
          version: 1,
          date: new Date().toISOString(),
          parts: parts
      };
      const blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rocket-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const content = event.target?.result as string;
              const parsed = JSON.parse(content);
              
              // Handle generic array or wrapped object
              let loadedParts = [];
              if (Array.isArray(parsed)) {
                  loadedParts = parsed;
              } else if (parsed.parts && Array.isArray(parsed.parts)) {
                  loadedParts = parsed.parts;
              } else {
                  throw new Error("Invalid format");
              }
              
              onPartsChange(loadedParts);
          } catch (err) {
              alert("Failed to load rocket design. Invalid file.");
          }
          // Reset input
          if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsText(file);
  };

  const triggerLoad = () => {
      fileInputRef.current?.click();
  };

  const totalMass = parts.reduce((sum, p) => sum + p.mass + (p.currentFuel || 0), 0);
  const totalCost = parts.reduce((sum, p) => sum + p.cost, 0);

  const renderPartTooltip = () => {
      if (!hoveredInfo) return null;
      const { part, top } = hoveredInfo;
      
      return (
          <div 
            className="fixed z-50 w-72 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-4 text-slate-100 pointer-events-none"
            style={{ left: '21rem', top: Math.min(top, window.innerHeight - 300) }} // Clamp so it doesn't go off screen
          >
              <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-lg text-white">{part.name}</h3>
                  <span className="text-[10px] uppercase bg-slate-700 px-2 py-0.5 rounded text-slate-400 font-bold">{part.type}</span>
              </div>
              <p className="text-sm text-slate-400 mb-4 italic leading-relaxed">{part.description}</p>
              
              <div className="space-y-2">
                  <div className="flex justify-between text-sm border-b border-slate-700 pb-1">
                      <span className="text-slate-500">Mass</span>
                      <span className="font-mono">{part.mass} <span className="text-slate-600 text-xs">kg</span></span>
                  </div>
                  <div className="flex justify-between text-sm border-b border-slate-700 pb-1">
                      <span className="text-slate-500">Cost</span>
                      <span className="font-mono text-green-400">${part.cost}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b border-slate-700 pb-1">
                      <span className="text-slate-500 flex items-center"><Wind size={12} className="mr-1"/> Drag Coeff</span>
                      <span className="font-mono">{part.dragCoeff}</span>
                  </div>
                  
                  {part.fuelCapacity !== undefined && (
                      <div className="flex justify-between text-sm border-b border-slate-700 pb-1">
                          <span className="text-slate-500 flex items-center"><Fuel size={12} className="mr-1"/> Fuel Cap</span>
                          <span className="font-mono text-cyan-400">{part.fuelCapacity} <span className="text-slate-600 text-xs">kg</span></span>
                      </div>
                  )}
                  
                  {part.thrust !== undefined && (
                      <div className="flex justify-between text-sm border-b border-slate-700 pb-1">
                          <span className="text-slate-500 flex items-center"><Gauge size={12} className="mr-1"/> Thrust</span>
                          <span className="font-mono text-orange-400">{(part.thrust/1000).toFixed(1)} <span className="text-slate-600 text-xs">kN</span></span>
                      </div>
                  )}
                  
                  {part.burnRate !== undefined && (
                       <div className="flex justify-between text-sm border-b border-slate-700 pb-1">
                          <span className="text-slate-500">Burn Rate</span>
                          <span className="font-mono">{part.burnRate} <span className="text-slate-600 text-xs">kg/s</span></span>
                      </div>
                  )}
              </div>
          </div>
      );
  };
  
  const renderPlacedPartTooltip = () => {
    if (!hoveredPlacedInfo) return null;
    const { id, x, y } = hoveredPlacedInfo;
    
    // Don't overlap with drag/sidebar if dragging
    if (draggedDef) return null;

    const part = parts.find(p => p.instanceId === id);
    if (!part) return null;

    const stageIndex = partStageMap.get(id);
    const stage = stageStats.find(s => s.stageIndex === stageIndex);
    
    // Convert logic stages (0=top, N=bottom) to user-facing stages (1=top, N+1=bottom) or vice versa.
    // Usually standard rocketry counts down (Stage 3 -> 2 -> 1).
    // Our stageStats has 0 as top. Let's just display "Stage X".
    
    // Offset tooltip from cursor
    const style: React.CSSProperties = {
        left: x + 15,
        top: y + 15,
    };
    
    // Ensure it stays on screen
    if (x > window.innerWidth - 300) style.left = x - 260;
    if (y > window.innerHeight - 200) style.top = y - 180;

    return (
        <div 
            className="fixed z-[60] w-60 bg-slate-900/90 backdrop-blur border border-cyan-500/50 rounded-lg shadow-2xl p-3 text-slate-100 pointer-events-none"
            style={style}
        >
            <div className="text-sm font-bold text-white mb-1 border-b border-white/10 pb-1">{part.name}</div>
            
            {stageIndex !== undefined && (
                 <div className="flex items-center text-xs font-bold text-yellow-500 mb-2">
                     <Layers size={12} className="mr-1"/> Stage {stageStats.length - stageIndex}
                 </div>
            )}
            
            {stage && (
                <div className="space-y-1">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <div className="text-slate-500">Stage Δv</div>
                            <div className="font-mono text-cyan-400">{stage.deltaV.toFixed(0)} m/s</div>
                        </div>
                        <div>
                            <div className="text-slate-500">Stage TWR</div>
                            <div className={`font-mono ${stage.twr < 1 ? 'text-red-400' : 'text-green-400'}`}>
                                {stage.twr.toFixed(2)}
                            </div>
                        </div>
                    </div>
                    {part.type === PartType.ENGINE && (
                         <div className="mt-2 pt-1 border-t border-white/10 text-xs">
                             <div className="text-slate-500">Thrust</div>
                             <div className="font-mono text-orange-400">{((part.thrust || 0)/1000).toFixed(1)} kN</div>
                         </div>
                    )}
                     {part.currentFuel !== undefined && (
                         <div className="mt-1 text-xs">
                             <div className="text-slate-500">Fuel</div>
                             <div className="font-mono text-blue-400">{part.currentFuel.toFixed(0)} kg</div>
                         </div>
                    )}
                </div>
            )}
            
            {!stage && <div className="text-xs text-slate-500">No stage data</div>}
        </div>
    );
  };

  return (
    <div 
        className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden" 
        onMouseMove={handleMouseMove}
        onMouseUp={handlePartDrop}
        onWheel={handleWheel}
    >
      <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleLoad} />

      {/* Sidebar */}
      <div className="w-80 bg-slate-800 border-r border-slate-700 flex flex-col z-20 shadow-xl select-none">
        <div className="p-4 border-b border-slate-700 bg-slate-800/95 backdrop-blur">
          <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
            Orbit Architect
          </h2>
          <p className="text-xs text-slate-400 mt-1">Right-click part to delete</p>
        </div>

        <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/50">
            <button 
                onClick={() => setSymmetryMode(!symmetryMode)}
                className={`w-full flex items-center justify-between p-2 rounded-lg border transition-all ${symmetryMode ? 'bg-indigo-900/50 border-indigo-500 text-indigo-300' : 'bg-slate-700 border-transparent text-slate-400 hover:border-slate-500'}`}
            >
                <div className="flex items-center">
                    <Columns size={18} className="mr-2" />
                    <span className="font-medium text-sm">Radial Symmetry</span>
                </div>
                <div className={`text-xs font-bold px-2 py-0.5 rounded ${symmetryMode ? 'bg-indigo-500 text-white' : 'bg-slate-900'}`}>
                    {symmetryMode ? 'ON' : 'OFF'}
                </div>
            </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {Object.values(PartType).map((type) => {
             const typeParts = AVAILABLE_PARTS.filter(p => p.type === type);
             if (typeParts.length === 0) return null;
             return (
               <div key={type} className="space-y-2">
                 <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{type}</h3>
                 <div className="grid grid-cols-1 gap-2">
                   {typeParts.map(part => (
                     <div
                       key={part.id}
                       onMouseEnter={(e) => setHoveredInfo({ part, top: e.currentTarget.getBoundingClientRect().top })}
                       onMouseLeave={() => setHoveredInfo(null)}
                       onMouseDown={() => {
                           setDraggedDef(part);
                           setDeleteMode(false); // Disable delete mode on drag
                           setHoveredInfo(null); // Hide tooltip when dragging starts
                       }}
                       className="cursor-grab active:cursor-grabbing flex items-center p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-left group border border-transparent hover:border-slate-500 relative"
                     >
                        <div className="w-10 h-10 bg-slate-800 rounded flex items-center justify-center mr-3 text-slate-400">
                           <MousePointer2 size={16} />
                        </div>
                        <div>
                          <div className="text-sm font-medium">{part.name}</div>
                          <div className="text-xs text-slate-400">${part.cost} | {part.mass}kg</div>
                        </div>
                     </div>
                   ))}
                 </div>
               </div>
             );
          })}
        </div>
      </div>

      {/* Main Assembly Area */}
      <div className={`flex-1 bg-slate-900 relative flex flex-col ${deleteMode ? 'cursor-crosshair' : ''}`} ref={containerRef}>
        <div className="absolute inset-0 opacity-20 pointer-events-none" 
             style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #334155 1px, transparent 0)', backgroundSize: '40px 40px' }}>
        </div>

        <div className="flex-1 overflow-hidden relative">
          {parts.length === 0 && !draggedDef ? (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 flex-col pointer-events-none">
              <Rocket size={48} className="mb-4 opacity-50" />
              <p>Drag a Command Pod here to start</p>
            </div>
          ) : (
             <RocketRenderer 
                parts={parts} 
                layout={layout} // Pass cached layout
                scale={zoom} 
                ghostPart={draggedDef ? { ...draggedDef, instanceId: 'ghost', nodes: draggedDef.nodes } as RocketPart : null}
                ghostPosition={snapNode ? { x: snapNode.x, y: snapNode.y } : mousePos}
                onPartClick={deleteMode ? removePart : undefined}
                onPartContextMenu={removePart}
                onPartHover={handlePlacedPartHover}
                isDeleteMode={deleteMode}
             />
          )}
          
          {/* Zoom Indicator */}
          <div className="absolute bottom-4 left-4 bg-slate-800/80 px-2 py-1 rounded text-xs text-slate-400 pointer-events-none">
             Zoom: {Math.round(zoom * 100)}%
          </div>
          
          {/* Active Snap Node Indicator */}
          {draggedDef && snapNode && (
             <div className="absolute pointer-events-none text-xs text-green-400 font-bold" 
                  style={{ left: 20, top: 20 }}>
                  Snapping to: {snapNode.nodeId}
             </div>
          )}
          
          {/* Delete Mode Indicator */}
          {deleteMode && (
              <div className="absolute top-4 right-4 bg-red-500/90 text-white px-3 py-1.5 rounded-full font-bold shadow-lg animate-pulse pointer-events-none flex items-center">
                  <Trash2 size={16} className="mr-2"/> DELETE MODE ACTIVE
              </div>
          )}
        </div>
        
        {/* Engineer's Report Toggle */}
        <div className="absolute top-4 right-4 z-20">
            <button 
                onClick={() => setShowEngineering(!showEngineering)}
                className={`p-2 rounded-lg flex items-center shadow-lg transition-colors ${showEngineering ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                title="Toggle Engineer's Report"
            >
                <Calculator size={20} />
            </button>
        </div>
        
        {/* Engineer's Report Panel */}
        {showEngineering && parts.length > 0 && (
            <div className="absolute top-16 right-4 z-20 w-64 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[70vh]">
                <div className="p-3 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
                    <h3 className="font-bold text-sm text-slate-200 flex items-center">
                        <Calculator size={14} className="mr-2 text-indigo-400"/> Engineer's Report
                    </h3>
                    <div className="text-xs font-mono text-cyan-400">
                        Δv: {totalDeltaV.toFixed(0)} m/s
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {stageStats.map((stage, idx) => (
                        <div key={stage.stageIndex} className="bg-slate-700/50 rounded border border-slate-600 p-2">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-xs font-bold text-slate-300">Stage {stageStats.length - idx}</span>
                                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                                    {(stage.wetMass/1000).toFixed(1)}t
                                </span>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 mb-1">
                                <div>
                                    <div className="text-[10px] text-slate-400">Delta-V</div>
                                    <div className="text-sm font-mono text-white">{stage.deltaV.toFixed(0)} <span className="text-[10px] text-slate-500">m/s</span></div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-slate-400">Thrust</div>
                                    <div className="text-sm font-mono text-white">{(stage.thrust/1000).toFixed(0)} <span className="text-[10px] text-slate-500">kN</span></div>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <div className="text-[10px] text-slate-400">TWR (Start)</div>
                                    <div className={`text-sm font-mono font-bold ${stage.twr < 1.0 && idx === 0 ? 'text-red-400' : 'text-green-400'}`}>
                                        {stage.twr.toFixed(2)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-slate-400">Burn Time</div>
                                    <div className="text-sm font-mono text-white">{stage.burnTime.toFixed(1)}s</div>
                                </div>
                            </div>

                            {idx === 0 && stage.twr < 1.0 && stage.thrust > 0 && (
                                <div className="mt-2 text-[10px] text-red-300 bg-red-900/30 p-1 rounded flex items-start">
                                    <AlertTriangle size={10} className="mr-1 mt-0.5"/> TWR &lt; 1.0: Lift-off impossible
                                </div>
                            )}
                        </div>
                    ))}
                    
                    {stageStats.length === 0 && (
                        <div className="text-center text-xs text-slate-500 py-4">
                            No active stages
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* Bottom Control Bar */}
        <div className="h-20 bg-slate-800 border-t border-slate-700 flex items-center justify-between px-6 z-10 select-none">
          <div className="flex items-center space-x-6 text-sm">
             <div><span className="text-slate-400 text-xs block">Total Mass</span><span className="font-mono">{(totalMass/1000).toFixed(2)}t</span></div>
             <div><span className="text-slate-400 text-xs block">Cost</span><span className="text-green-400 font-mono">${totalCost}</span></div>
          </div>
          <div className="flex items-center space-x-3">
             <button onClick={handleSave} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded" title="Save Design"><Download size={20}/></button>
             <button onClick={triggerLoad} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded" title="Load Design"><Upload size={20}/></button>
             <div className="w-px h-8 bg-slate-700 mx-2"></div>
             <button 
                onClick={() => setDeleteMode(!deleteMode)}
                className={`p-2 rounded transition-all ${deleteMode ? 'bg-red-600 text-white shadow-lg shadow-red-900/50' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                title="Delete Mode (Click part to delete)"
             >
                <Trash2 size={20}/>
             </button>
             <div className="w-px h-8 bg-slate-700 mx-2"></div>
             <button onClick={() => onPartsChange([])} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded" title="Clear All"><RotateCcw size={20}/></button>
             <button onClick={handleGeminiAnalysis} className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium ml-2">{analyzing ? '...' : 'AI Analysis'}</button>
             <button onClick={onLaunch} disabled={parts.length===0} className="flex items-center px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold"><Rocket size={18} className="mr-2"/> LAUNCH</button>
          </div>
        </div>
      </div>
      
      {/* Tooltip Overlay */}
      {renderPartTooltip()}
      {renderPlacedPartTooltip()}

      {/* Analysis Overlay */}
      {analysis && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
           <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
              <h3 className="text-xl font-bold text-white">{analysis.missionName}</h3>
              <p className="text-slate-300">{analysis.analysis}</p>
              <div className="text-2xl font-bold text-green-400">{analysis.successProbability}% Success</div>
              <ul className="list-disc pl-5 text-slate-400 text-sm">{analysis.tips?.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
              <button onClick={() => setAnalysis(null)} className="w-full py-2 bg-slate-700 hover:bg-slate-600 rounded text-white">Close</button>
           </div>
        </div>
      )}
    </div>
  );
};