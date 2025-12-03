import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RocketPart, PartType, SimulationState, TelemetryPoint, Vector2, SASMode } from '../types';
import { Play, Layers, Square, Pause, CircleOff, ArrowUpCircle, ArrowDownCircle, X } from 'lucide-react';
import { calculateRocketLayout, SCALE } from '../utils/rocketUtils';
import { drawPartShape, getPartStyle } from '../utils/renderUtils';
import { getChildrenMap, findFuelSources, isEngineBlockedByStage } from '../utils/fuelUtils';

interface SimulationProps {
  initialParts: RocketPart[];
  onExit: () => void;
}

// Planetary Constants (Kerbin-like)
const PLANET_RADIUS = 600000; // 600km
const SURFACE_GRAVITY = 9.81;
const GRAVITATIONAL_PARAM = SURFACE_GRAVITY * PLANET_RADIUS * PLANET_RADIUS; 
const ATMOSPHERE_HEIGHT = 70000;

// Moon Constants ("The Mun")
const MOON_RADIUS = 200000; 
const MOON_ORBIT_RADIUS = 12000000; 
const MOON_SURFACE_GRAVITY = 1.63;
const MOON_GRAVITATIONAL_PARAM = MOON_SURFACE_GRAVITY * MOON_RADIUS * MOON_RADIUS;
const MOON_ORBITAL_PERIOD = 2 * Math.PI * Math.sqrt(Math.pow(MOON_ORBIT_RADIUS, 3) / GRAVITATIONAL_PARAM);
const MOON_SOI_RADIUS = MOON_ORBIT_RADIUS * Math.pow(MOON_GRAVITATIONAL_PARAM / GRAVITATIONAL_PARAM, 2/5);

const BASE_TIME_STEP = 0.05; 

// Vector Math Helpers
const vAdd = (a: Vector2, b: Vector2) => ({ x: a.x + b.x, y: a.y + b.y });
const vScale = (v: Vector2, s: number) => ({ x: v.x * s, y: v.y * s });
const vMag = (v: Vector2) => Math.sqrt(v.x * v.x + v.y * v.y);
const vNorm = (v: Vector2) => { const m = vMag(v); return m === 0 ? { x: 0, y: 0 } : vScale(v, 1/m); };
const vDot = (a: Vector2, b: Vector2) => a.x * b.x + a.y * b.y;

// NavBall Component (Internal)
const NavBall: React.FC<{ rotation: number, velocity: Vector2, sasMode: SASMode, nearestBodyAngle: number }> = ({ rotation, velocity, sasMode, nearestBodyAngle }) => {
    const rad2deg = 180 / Math.PI;
    // The background rotates to show "Up" (Radial Out) relative to the rocket
    const bgRotation = ((nearestBodyAngle + Math.PI/2) - rotation) * rad2deg;
    
    // Prograde/Retrograde relative to Rocket Frame
    const velAngle = Math.atan2(velocity.y, velocity.x);
    const progradeRot = (velAngle - (rotation - Math.PI/2)) * rad2deg;
    const retrogradeRot = progradeRot + 180;
    const speed = vMag(velocity);

    return (
        <div className="relative w-32 h-32 rounded-full border-4 border-slate-600 bg-slate-800 overflow-hidden shadow-2xl shrink-0">
             <div className="absolute inset-[-50%] w-[200%] h-[200%] origin-center transition-transform duration-75"
                style={{ background: 'linear-gradient(to bottom, #3b82f6 50%, #854d0e 50%)', transform: `rotate(${bgRotation}deg)` }}>
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-white/50 -mt-[1px]"></div>
            </div>
            {/* Crosshair (Rocket) */}
            <div className="absolute inset-0 flex items-center justify-center opacity-80 pointer-events-none">
                 <div className="w-8 h-1 bg-orange-500 rounded-full absolute"></div>
                 <div className="w-1 h-4 bg-orange-500 rounded-full absolute -mt-2"></div>
            </div>
            {speed > 1 && (
                <>
                <div className="absolute top-1/2 left-1/2 w-0 h-0 flex items-center justify-center transition-transform duration-75" style={{ transform: `rotate(${progradeRot}deg) translateY(-54px)` }}>
                     <div className="w-4 h-4 rounded-full border-2 border-green-400 flex items-center justify-center">
                         <div className="w-1 h-1 bg-green-400 rounded-full"></div>
                     </div>
                </div>
                 <div className="absolute top-1/2 left-1/2 w-0 h-0 flex items-center justify-center transition-transform duration-75" style={{ transform: `rotate(${retrogradeRot}deg) translateY(-54px)` }}>
                     <div className="w-4 h-4 rounded-full border-2 border-red-500 flex items-center justify-center">
                        <X size={12} className="text-red-500"/>
                     </div>
                </div>
                </>
            )}
        </div>
    );
};

export const Simulation: React.FC<SimulationProps> = ({ initialParts, onExit }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Simulation Settings
  // Default Zoom: 40 pixels per meter (Matches builder scale roughly)
  const [zoom, setZoom] = useState(40); 
  const zoomRef = useRef(zoom); // Ref for game loop access
  const [timeWarp, setTimeWarp] = useState(1);
  const timeWarpRef = useRef(timeWarp);
  const [focusBody, setFocusBody] = useState<'ROCKET' | 'MOON' | 'PLANET'>('ROCKET');
  const focusBodyRef = useRef(focusBody);

  // Initial State: Launchpad at (0, -Radius) - Exactly on surface
  const initialPos = { x: 0, y: -PLANET_RADIUS }; 

  const [activeParts, setActiveParts] = useState<RocketPart[]>(() => JSON.parse(JSON.stringify(initialParts)));
  
  const keysRef = useRef({ left: false, right: false, shift: false, ctrl: false, z: false, x: false });
  const [throttle, setThrottle] = useState(0); // Start at 0%
  const [sasMode, setSasMode] = useState<SASMode>(SASMode.STABILITY);
  const [targetRotation, setTargetRotation] = useState(0); 

  const [simState, setSimState] = useState<SimulationState>({
    position: initialPos,
    velocity: { x: 0, y: 0 },
    rotation: 0,
    angularVelocity: 0,
    throttle: 0, // Start zero throttle
    sasMode: SASMode.STABILITY,
    altitude: 0,
    velocityMag: 0,
    verticalVelocity: 0,
    horizontalVelocity: 0,
    acceleration: 0,
    time: 0,
    semiMajorAxis: 0,
    eccentricity: 0,
    apoapsis: 0,
    periapsis: 0,
    parts: activeParts,
    debris: [],
    active: true, // Start active (physics running but rocket sits on pad)
    finished: false,
    maxAltitude: 0,
    events: [],
    forces: { thrust: {x:0, y:0}, gravity: {x:0, y:0}, drag: {x:0, y:0} }
  });

  const requestRef = useRef<number>(0);
  const stateRef = useRef(simState);

  // Sync State Ref
  useEffect(() => {
    stateRef.current = { ...stateRef.current, active: simState.active, finished: simState.finished, parts: activeParts, throttle, sasMode };
    zoomRef.current = zoom;
    timeWarpRef.current = timeWarp;
    focusBodyRef.current = focusBody;
  }, [simState.active, simState.finished, activeParts, throttle, sasMode, zoom, timeWarp, focusBody]);

  // Input Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') keysRef.current.left = true;
      if (e.key === 'ArrowRight') keysRef.current.right = true;
      if (e.key === 'Shift') setThrottle(t => Math.min(1, t + 0.1));
      if (e.key === 'Control') setThrottle(t => Math.max(0, t - 0.1));
      if (e.key === 'z') setThrottle(1);
      if (e.key === 'x') setThrottle(0);
      if (e.key === 't') setSasMode(m => m === SASMode.STABILITY ? SASMode.MANUAL : SASMode.STABILITY);
      if (e.key === '.') setTimeWarp(w => Math.min(100, w === 0 ? 1 : w < 5 ? w + 1 : w * 2));
      if (e.key === ',') setTimeWarp(w => Math.max(1, w > 5 ? w / 2 : w - 1));
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') keysRef.current.left = false;
      if (e.key === 'ArrowRight') keysRef.current.right = false;
    };
    const handleWheel = (e: WheelEvent) => {
        // Max zoom increased to 200 for close-ups
        setZoom(prev => Math.max(0.00001, Math.min(prev * (1 - e.deltaY * 0.001), 200)));
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWheel);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // --- RENDERING FUNCTION (Defined before loop) ---
  const drawFrame = () => {
     if (!canvasRef.current) return;
     const ctx = canvasRef.current.getContext('2d');
     if (!ctx) return;
     const { width, height } = canvasRef.current;
     const state = stateRef.current;
     const zoom = zoomRef.current;
     const focusBody = focusBodyRef.current;
     
     const moonAngle = (state.time / MOON_ORBITAL_PERIOD) * 2 * Math.PI;
     const moonPos = { x: Math.cos(moonAngle) * MOON_ORBIT_RADIUS, y: Math.sin(moonAngle) * MOON_ORBIT_RADIUS };
     
     // Camera Transform
     let camX = state.position.x;
     let camY = state.position.y;
     if (focusBody === 'MOON') { camX = moonPos.x; camY = moonPos.y; }
     if (focusBody === 'PLANET') { camX = 0; camY = 0; }
     
     ctx.fillStyle = '#0f172a';
     ctx.fillRect(0,0,width,height);
     
     ctx.save();
     ctx.translate(width/2, height/2);
     ctx.scale(zoom, zoom);
     ctx.translate(-camX, -camY);

     // 1. Planet
     ctx.fillStyle = '#3b82f6';
     ctx.beginPath(); ctx.arc(0, 0, PLANET_RADIUS, 0, Math.PI*2); ctx.fill();
     ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
     ctx.beginPath(); ctx.arc(0, 0, PLANET_RADIUS + ATMOSPHERE_HEIGHT, 0, Math.PI*2); ctx.fill();
     // Planet Grid
     ctx.strokeStyle = 'rgba(255,255,255,0.1)';
     ctx.lineWidth = PLANET_RADIUS / 20;
     ctx.beginPath(); ctx.moveTo(0, -PLANET_RADIUS); ctx.lineTo(0, PLANET_RADIUS); ctx.stroke();
     ctx.beginPath(); ctx.moveTo(-PLANET_RADIUS, 0); ctx.lineTo(PLANET_RADIUS, 0); ctx.stroke();

     // 2. Moon
     ctx.fillStyle = '#94a3b8';
     ctx.beginPath(); ctx.arc(moonPos.x, moonPos.y, MOON_RADIUS, 0, Math.PI*2); ctx.fill();
     // Craters
     ctx.fillStyle = '#64748b';
     ctx.beginPath(); ctx.arc(moonPos.x + MOON_RADIUS*0.3, moonPos.y - MOON_RADIUS*0.2, MOON_RADIUS*0.2, 0, Math.PI*2); ctx.fill();
     
     // 3. Orbit Line
     ctx.strokeStyle = '#334155';
     ctx.lineWidth = 1 / zoom;
     ctx.beginPath(); ctx.arc(0, 0, MOON_ORBIT_RADIUS, 0, Math.PI*2); ctx.stroke();

     // 4. Rocket
     // Draw Icon if zoomed out
     if (zoom < 0.1) {
         ctx.fillStyle = '#facc15';
         const iconSize = 10 / zoom;
         ctx.beginPath(); ctx.arc(state.position.x, state.position.y, iconSize, 0, Math.PI*2); ctx.fill();
     } else {
         // Draw Parts
         ctx.translate(state.position.x, state.position.y);
         ctx.rotate(state.rotation);
         const layout = calculateRocketLayout(state.parts);
         layout.forEach(p => {
             ctx.save();
             // Convert pixels from layout to meters
             ctx.translate(p.x/SCALE, p.y/SCALE); 
             ctx.rotate(p.rotation);
             if (p.radialOffset === -1) ctx.scale(-1, 1);
             const style = getPartStyle(p.type);
             ctx.fillStyle = style.fill;
             ctx.strokeStyle = style.stroke;
             ctx.lineWidth = 0.1;
             drawPartShape(ctx, p.type, p.width, p.height, p.isThrusting); 
             ctx.fill();
             ctx.stroke();

             // Fuel Level Overlay
             if (p.type === PartType.TANK && p.fuelCapacity && p.currentFuel !== undefined) {
                 const fuelRatio = p.currentFuel / p.fuelCapacity;
                 const fuelHeight = p.height * fuelRatio;
                 
                 ctx.save();
                 // Create clip from the tank shape to handle rounded corners
                 drawPartShape(ctx, p.type, p.width, p.height, false);
                 ctx.clip();
                 
                 const hh = p.height / 2;
                 const hw = p.width / 2;
                 
                 ctx.fillStyle = 'rgba(6, 182, 212, 0.4)'; // Cyan-ish transparency
                 // Draw from bottom up
                 ctx.fillRect(-hw, hh - fuelHeight, p.width, fuelHeight);
                 ctx.restore();
             }

             // Engine Flame
             if (p.type === PartType.ENGINE && p.isThrusting) {
                 ctx.fillStyle = '#f97316';
                 ctx.beginPath();
                 ctx.moveTo(-p.width/4, p.height/2);
                 ctx.lineTo(p.width/4, p.height/2);
                 ctx.lineTo(0, p.height/2 + 2 + Math.random()*2); 
                 ctx.fill();
             }
             ctx.restore();
         });
     }
     ctx.restore();
  };

  // --- PHYSICS ENGINE ---
  const updatePhysics = () => {
    const currentState = stateRef.current;
    if (!currentState.active || currentState.finished) return;

    let { position, velocity, rotation, angularVelocity, time, parts, events, maxAltitude } = currentState;
    const warp = timeWarpRef.current;
    
    // Run physics steps based on Time Warp
    const steps = Math.max(1, Math.floor(warp)); 
    const maxSteps = 10; 
    const effectiveSteps = Math.min(steps, maxSteps);
    const dt = BASE_TIME_STEP * (steps / effectiveSteps); 

    // Build Connectivity Map for Fuel Flow (BFS)
    const childrenMap = getChildrenMap(parts);

    for(let s = 0; s < effectiveSteps; s++) {
        time += dt;

        // 1. Celestial Positions
        const moonAngle = (time / MOON_ORBITAL_PERIOD) * 2 * Math.PI;
        const moonPos = { x: Math.cos(moonAngle) * MOON_ORBIT_RADIUS, y: Math.sin(moonAngle) * MOON_ORBIT_RADIUS };

        // 2. Mass Properties
        let mass = 0;
        let momentOfInertia = 0;
        let dragArea = 0;
        
        parts.forEach(p => {
            const m = p.mass + (p.currentFuel || 0);
            mass += m;
            dragArea += p.width * p.width; 
            momentOfInertia += m * 10; 
        });
        momentOfInertia = Math.max(momentOfInertia, 100);

        // 3. Gravity (N-Body)
        // Planet
        const r2 = position.x*position.x + position.y*position.y;
        const r = Math.sqrt(r2);
        const fGravityP = -GRAVITATIONAL_PARAM / r2; 
        const gVecP = { x: fGravityP * (position.x/r), y: fGravityP * (position.y/r) };

        // Moon
        const dMx = position.x - moonPos.x;
        const dMy = position.y - moonPos.y;
        const rm2 = dMx*dMx + dMy*dMy;
        const rm = Math.sqrt(rm2);
        const fGravityM = -MOON_GRAVITATIONAL_PARAM / rm2;
        const gVecM = { x: fGravityM * (dMx/rm), y: fGravityM * (dMy/rm) };

        const totalGravity = vAdd(gVecP, gVecM);

        // 4. Atmosphere & Drag
        const altitudeSea = r - PLANET_RADIUS;
        let density = 0;
        if (altitudeSea < ATMOSPHERE_HEIGHT) {
            density = 1.225 * Math.exp(-altitudeSea / 7000);
        }
        
        const speedSq = vDot(velocity, velocity);
        const speed = Math.sqrt(speedSq);
        let dragForce = { x: 0, y: 0 };
        
        if (density > 0 && speed > 0.1) {
             const dragMag = 0.5 * density * speedSq * dragArea * 0.2; 
             const velDir = vNorm(velocity);
             dragForce = vScale(velDir, -dragMag);
        }

        // 5. Thrust & Fuel Logic
        let totalThrust = 0;
        const thrustDir = { x: Math.sin(rotation), y: -Math.cos(rotation) }; 
        const currentThrottle = stateRef.current.throttle;
        
        if (currentThrottle > 0) {
            parts.forEach(p => {
                if (p.type === PartType.ENGINE) {
                    // Check Staging: If blocked by a stack decoupler, it shouldn't fire.
                    const isBlocked = isEngineBlockedByStage(p, childrenMap);
                    
                    if (!isBlocked) {
                        const maxT = p.thrust || 0;
                        if (maxT > 0) {
                            const requiredFuel = (p.burnRate || 0) * currentThrottle * dt;

                            // Use shared logic for fuel source discovery
                            const allPossibleSources = findFuelSources(p, parts, childrenMap);
                            
                            // Filter for sources that actually have fuel remaining
                            const fuelSources = allPossibleSources.filter(s => (s.part.currentFuel || 0) > 0.000001); // Strict threshold
                            let totalFuelAvailable = fuelSources.reduce((sum, s) => sum + (s.part.currentFuel || 0), 0);

                            // Burn Logic
                            if (totalFuelAvailable >= requiredFuel && requiredFuel > 0) {
                                let remainingBurn = requiredFuel;

                                // Group by distance
                                const groups = new Map<number, RocketPart[]>();
                                fuelSources.forEach(s => {
                                    if (!groups.has(s.dist)) groups.set(s.dist, []);
                                    groups.get(s.dist)!.push(s.part);
                                });

                                // Sort distances DESCENDING (Drain furthest tanks first)
                                const sortedDistances = Array.from(groups.keys()).sort((a, b) => b - a);

                                for (const dist of sortedDistances) {
                                    if (remainingBurn <= 0) break;
                                    
                                    const tanks = groups.get(dist)!;
                                    // Recalculate group total (in case of floating point drift, though purely local here)
                                    const groupTotal = tanks.reduce((sum, t) => sum + (t.currentFuel || 0), 0);
                                    
                                    const take = Math.min(groupTotal, remainingBurn);
                                    
                                    if (groupTotal > 0) {
                                        tanks.forEach(t => {
                                            // Proportional drain: ensures tanks drain evenly relative to their size
                                            const fraction = (t.currentFuel || 0) / groupTotal;
                                            const amount = take * fraction;
                                            t.currentFuel = Math.max(0, (t.currentFuel || 0) - amount);
                                            // Prevent tiny residuals
                                            if (t.currentFuel < 0.000001) t.currentFuel = 0;
                                        });
                                    }
                                    
                                    remainingBurn -= take;
                                }
                                
                                totalThrust += maxT * currentThrottle;
                                p.isThrusting = true;
                            } else if (totalFuelAvailable > 0) {
                                // Partial burn
                                fuelSources.forEach(s => s.part.currentFuel = 0);
                                const ratio = requiredFuel > 0 ? totalFuelAvailable / requiredFuel : 0;
                                totalThrust += maxT * currentThrottle * ratio;
                                // Only visual thrust if significant
                                p.isThrusting = ratio > 0.01;
                            } else {
                                p.isThrusting = false;
                            }
                        }
                    } else {
                        p.isThrusting = false;
                    }
                } else {
                    p.isThrusting = false;
                }
            });
        } else {
            parts.forEach(p => p.isThrusting = false);
        }

        const thrustVec = vScale(thrustDir, totalThrust);

        // 6. Rotation (SAS & Input)
        let controlTorque = 0;
        if (keysRef.current.left) controlTorque -= 10000;
        if (keysRef.current.right) controlTorque += 10000;
        
        // SAS Logic
        const sas = stateRef.current.sasMode;
        if (sas !== SASMode.MANUAL) {
            let target = targetRotation; // use default manual target?
            // Actually, keep stability relative to current unless specific mode
            if (sas === SASMode.PROGRADE && speed > 1) {
                target = Math.atan2(velocity.y, velocity.x) + Math.PI/2;
            } else if (sas === SASMode.RETROGRADE && speed > 1) {
                target = Math.atan2(velocity.y, velocity.x) - Math.PI/2;
            } else if (sas === SASMode.STABILITY) {
                 // Damping only
                 controlTorque -= angularVelocity * momentOfInertia * 2.0; 
            }
            
            if (sas !== SASMode.STABILITY) {
                let err = target - rotation;
                while (err > Math.PI) err -= Math.PI*2;
                while (err < -Math.PI) err += Math.PI*2;
                const P = err * 20000; 
                const D = angularVelocity * 20000; 
                controlTorque += (P - D);
            }
        } else {
             controlTorque -= angularVelocity * momentOfInertia * 0.1; 
        }

        const alpha = controlTorque / momentOfInertia;
        angularVelocity += alpha * dt;
        rotation += angularVelocity * dt;

        // 7. Integration
        const force = vAdd(vAdd(totalGravity, dragForce), thrustVec);
        const accel = vScale(force, 1/mass);
        
        velocity = vAdd(velocity, vScale(accel, dt));
        position = vAdd(position, vScale(velocity, dt));

        // 8. Collisions
        // Planet Surface
        if (vMag(position) <= PLANET_RADIUS) {
            const radialVel = vDot(velocity, vNorm(position));
            
            if (radialVel < -10) {
                 events.push(`Crashed into Planet`);
                 currentState.active = false;
                 currentState.finished = true;
            } else if (vMag(velocity) < 1) {
                 // Only trigger landing if we have actually flown high enough
                 if (maxAltitude > 50) {
                     events.push("Landed on Planet");
                     currentState.active = false;
                     currentState.finished = true;
                 } else {
                     // Just resting on pad - clamp to surface
                     position = vScale(vNorm(position), PLANET_RADIUS);
                     velocity = { x: 0, y: 0 };
                 }
            } else {
                 // Hard stop if slow enough but not landed state
                 position = vScale(vNorm(position), PLANET_RADIUS);
                 if (radialVel < 0) {
                     // Kill radial velocity if moving down
                     const tangent = { x: -position.y, y: position.x };
                     const tMag = vMag(tangent);
                     const tNorm = tMag > 0 ? vScale(tangent, 1/tMag) : {x:0, y:0};
                     const tVel = vDot(velocity, tNorm);
                     velocity = vScale(tNorm, tVel);
                 }
            }
        }
        
        // Moon Surface
        if (rm <= MOON_RADIUS) {
            const radialVel = vDot(velocity, vNorm({x: dMx, y: dMy}));
            if (radialVel < -10) {
                events.push(`Crashed into Moon`);
                currentState.active = false;
                currentState.finished = true;
            } else {
                events.push("THE EAGLE HAS LANDED!");
                currentState.active = false;
                currentState.finished = true;
                position = vAdd(moonPos, vScale(vNorm({x: dMx, y: dMy}), MOON_RADIUS));
                velocity = { x: 0, y: 0 }; 
            }
        }
    }

    // Telemetry Update
    const distCenter = vMag(position);
    const altitude = distCenter - PLANET_RADIUS;
    
    stateRef.current = {
        ...currentState,
        position, velocity, rotation, angularVelocity, time, maxAltitude: Math.max(maxAltitude, altitude), events, parts,
        altitude,
        velocityMag: vMag(velocity),
    };
    
    setSimState(stateRef.current);
  };

  // --- ANIMATION LOOP ---
  const animate = useCallback(() => {
    updatePhysics();
    drawFrame();
    requestRef.current = requestAnimationFrame(animate);
  }, []); // Empty dependencies ensures loop stability

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [animate]);


  const handleStage = () => {
      const parts = stateRef.current.parts;
      const layout = calculateRocketLayout(parts);
      const decouplers = parts.filter(p => p.type === PartType.DECOUPLER);
      if (decouplers.length === 0) return;
      
      const sorted = decouplers.map(d => {
          const l = layout.find(lp => lp.instanceId === d.instanceId);
          return { part: d, y: l ? l.y : 0 };
      }).sort((a,b) => b.y - a.y);
      const target = sorted[0].part;
      
      const toRemove = new Set<string>();
      const stack = [target.instanceId];
      toRemove.add(target.instanceId);
      
      while(stack.length > 0) {
          const pid = stack.pop()!;
          const children = parts.filter(p => p.parentId === pid);
          children.forEach(c => {
              toRemove.add(c.instanceId);
              stack.push(c.instanceId);
          });
      }
      
      const remaining = parts.filter(p => !toRemove.has(p.instanceId));
      setActiveParts(remaining);
      stateRef.current.events.push(`Staged: ${target.name}`);
  };

  const state = simState;
  const moonAngle = (state.time / MOON_ORBITAL_PERIOD) * 2 * Math.PI;
  const moonPos = { x: Math.cos(moonAngle) * MOON_ORBIT_RADIUS, y: Math.sin(moonAngle) * MOON_ORBIT_RADIUS };
  const distToMoon = Math.sqrt(Math.pow(state.position.x - moonPos.x, 2) + Math.pow(state.position.y - moonPos.y, 2));
  const isInMoonSOI = distToMoon < MOON_SOI_RADIUS;
  
  const altitudeDisplay = isInMoonSOI ? (distToMoon - MOON_RADIUS) : state.altitude;
  const nearestBodyAngle = isInMoonSOI ? Math.atan2(state.position.y - moonPos.y, state.position.x - moonPos.x) : Math.atan2(state.position.y, state.position.x);

  return (
    <div className="flex h-screen bg-slate-900 text-white relative overflow-hidden">
        <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight} className="absolute inset-0 block" />

        {/* UI Overlay */}
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
            <div className="flex justify-between items-start pointer-events-auto">
                <div className="space-y-2">
                    <div className="bg-slate-900/80 backdrop-blur border border-slate-700 p-4 rounded-xl shadow-xl w-64">
                         <div className="flex justify-between items-end mb-2">
                             <div className="text-xs uppercase text-slate-400 font-bold">{isInMoonSOI ? 'MOON ALT' : 'ALTITUDE'}</div>
                             <div className="text-2xl font-mono text-cyan-400">{(altitudeDisplay/1000).toFixed(1)} <span className="text-sm text-slate-500">km</span></div>
                         </div>
                         <div className="flex justify-between items-end">
                             <div className="text-xs uppercase text-slate-400 font-bold">SPEED</div>
                             <div className="text-2xl font-mono text-cyan-400">{state.velocityMag.toFixed(0)} <span className="text-sm text-slate-500">m/s</span></div>
                         </div>
                    </div>
                    <div className="bg-slate-900/80 backdrop-blur border border-slate-700 p-2 rounded-xl flex items-center space-x-4">
                        <div className="text-xs text-slate-400 font-bold px-2">WARP</div>
                        <div className="flex space-x-1">
                            {[1, 5, 10, 50, 100].map(w => (
                                <button onClick={() => setTimeWarp(w)} key={w} className={`w-8 h-6 flex items-center justify-center text-xs font-bold rounded ${timeWarp >= w ? 'bg-green-500 text-black' : 'bg-slate-700 text-slate-500'}`}>{w}x</button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="bg-slate-900/80 backdrop-blur border border-slate-700 p-4 rounded-xl shadow-xl w-64 max-h-48 overflow-y-auto">
                    <div className="text-xs uppercase text-slate-400 font-bold mb-2 border-b border-white/10 pb-1">Mission Log</div>
                    {state.events.slice().reverse().map((e, i) => (
                        <div key={i} className="text-xs text-slate-300 py-0.5 border-l-2 border-orange-500 pl-2 mb-1">{e}</div>
                    ))}
                </div>
            </div>

            <div className="flex items-end justify-between pointer-events-auto">
                <div className="flex items-end space-x-4">
                    <NavBall rotation={state.rotation} velocity={state.velocity} sasMode={sasMode} nearestBodyAngle={nearestBodyAngle} />
                    <div className="h-32 w-8 bg-slate-800 rounded-full border border-slate-600 relative overflow-hidden">
                        <div className="absolute bottom-0 left-0 right-0 bg-orange-500 transition-all duration-100 ease-linear" style={{ height: `${throttle * 100}%` }}></div>
                        <div className="absolute inset-0 flex flex-col justify-between py-2 items-center text-[10px] font-bold text-white/50 mix-blend-difference"><span>100</span><span>50</span><span>0</span></div>
                    </div>
                </div>

                <div className="flex flex-col space-y-2 bg-slate-900/80 backdrop-blur p-2 rounded-xl border border-slate-700">
                     <div className="text-xs font-bold text-slate-400 text-center">SAS CONTROL</div>
                     <div className="flex space-x-2">
                         <button onClick={() => setSasMode(SASMode.STABILITY)} className={`p-2 rounded ${sasMode === SASMode.STABILITY ? 'bg-cyan-600' : 'bg-slate-700'}`} title="Stability"><CircleOff size={18}/></button>
                         <button onClick={() => setSasMode(SASMode.PROGRADE)} className={`p-2 rounded ${sasMode === SASMode.PROGRADE ? 'bg-green-600' : 'bg-slate-700'}`} title="Prograde"><ArrowUpCircle size={18}/></button>
                         <button onClick={() => setSasMode(SASMode.RETROGRADE)} className={`p-2 rounded ${sasMode === SASMode.RETROGRADE ? 'bg-orange-600' : 'bg-slate-700'}`} title="Retrograde"><ArrowDownCircle size={18}/></button>
                     </div>
                </div>

                <div className="flex items-center space-x-4 bg-slate-900/80 backdrop-blur p-3 rounded-full border border-slate-700">
                    <button onClick={() => setSimState(s => ({...s, active: !s.active}))} className="p-3 bg-green-600 hover:bg-green-500 rounded-full text-white shadow-lg shadow-green-900/40">
                        {simState.active ? <Pause fill="currentColor"/> : <Play fill="currentColor" className="ml-1"/>}
                    </button>
                    <button onClick={handleStage} className="px-6 py-3 bg-yellow-600 hover:bg-yellow-500 rounded-full font-bold text-white shadow-lg shadow-yellow-900/40 flex items-center">
                        <Layers className="mr-2" size={18}/> STAGE
                    </button>
                </div>

                <div className="flex flex-col space-y-2">
                    <div className="bg-slate-900/80 backdrop-blur p-2 rounded-xl border border-slate-700 flex space-x-2">
                        <button onClick={() => setFocusBody('ROCKET')} className={`p-2 rounded ${focusBody === 'ROCKET' ? 'bg-blue-600' : 'bg-slate-700'}`} title="Focus Ship"><RocketPartIcon/></button>
                        <button onClick={() => setFocusBody('MOON')} className={`p-2 rounded ${focusBody === 'MOON' ? 'bg-slate-500' : 'bg-slate-700'}`} title="Focus Moon"><div className="w-4 h-4 rounded-full bg-gray-300"></div></button>
                        <button onClick={() => setFocusBody('PLANET')} className={`p-2 rounded ${focusBody === 'PLANET' ? 'bg-blue-400' : 'bg-slate-700'}`} title="Focus Planet"><div className="w-4 h-4 rounded-full bg-blue-500"></div></button>
                    </div>
                    <button onClick={onExit} className="p-3 bg-red-600 hover:bg-red-500 rounded-full text-white shadow-lg shadow-red-900/40 self-end">
                        <Square fill="currentColor" size={18}/>
                    </button>
                </div>
            </div>
             <div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-white/30 text-[10px] font-mono pointer-events-none text-center">
                SHIFT/CTRL: Throttle • Z/X: Max/Cut • T: SAS Toggle • &lt;/&gt;: Warp
            </div>
        </div>
    </div>
  );
};

const RocketPartIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
    </svg>
);
