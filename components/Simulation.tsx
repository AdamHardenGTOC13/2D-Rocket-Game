import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { RocketPart, PartType, SimulationState, TelemetryPoint, Vector2, SASMode } from '../types';
import { Play, Layers, Square, Pause, CircleOff, ArrowUpCircle, ArrowDownCircle, X, Umbrella } from 'lucide-react';
import { calculateRocketLayout, SCALE } from '../utils/rocketUtils';
import { drawPartShape, getPartStyle } from '../utils/renderUtils';
import { getChildrenMap, findFuelSources, isEngineBlockedByStage } from '../utils/fuelUtils';
import { assignStages } from '../utils/engineeringUtils';

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
const vSub = (a: Vector2, b: Vector2) => ({ x: a.x - b.x, y: a.y - b.y });
const vScale = (v: Vector2, s: number) => ({ x: v.x * s, y: v.y * s });
const vMag = (v: Vector2) => Math.sqrt(v.x * v.x + v.y * v.y);
const vNorm = (v: Vector2) => { const m = vMag(v); return m === 0 ? { x: 0, y: 0 } : vScale(v, 1/m); };
const vDot = (a: Vector2, b: Vector2) => a.x * b.x + a.y * b.y;
const vCrossMag = (a: Vector2, b: Vector2) => a.x * b.y - a.y * b.x;

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
  
  const keysRef = useRef({ left: false, right: false, shift: false, ctrl: false, z: false, x: false, p: false });
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

  // Sync State Ref - Split effects to avoid resetting fuel
  useEffect(() => {
    stateRef.current = { 
        ...stateRef.current, 
        active: simState.active, 
        finished: simState.finished, 
        throttle, 
        sasMode 
    };
    zoomRef.current = zoom;
    timeWarpRef.current = timeWarp;
    focusBodyRef.current = focusBody;
  }, [simState.active, simState.finished, throttle, sasMode, zoom, timeWarp, focusBody]);

  // Only sync parts when structural changes occur (Staging)
  useEffect(() => {
      stateRef.current.parts = activeParts;
  }, [activeParts]);

  // Input Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') keysRef.current.left = true;
      if (e.key === 'ArrowRight') keysRef.current.right = true;
      if (e.key === 'Shift') setThrottle(t => Math.min(1, t + 0.1));
      if (e.key === 'Control') setThrottle(t => {
          const next = t - 0.1;
          return next < 0.01 ? 0 : next; // Snap to 0
      });
      if (e.key === 'z') setThrottle(1);
      if (e.key === 'x') setThrottle(0);
      if (e.key === 't') setSasMode(m => m === SASMode.STABILITY ? SASMode.MANUAL : SASMode.STABILITY);
      if (e.key === 'p') deployParachutes();
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

  const deployParachutes = () => {
      setActiveParts(prev => {
          const next = prev.map(p => {
              if (p.type === PartType.PARACHUTE && !p.isDeployed) {
                  return { ...p, isDeployed: true };
              }
              return p;
          });
          // Add event if any deployed
          const deployed = next.some((p, i) => p.isDeployed && !prev[i].isDeployed);
          if (deployed) {
              stateRef.current.events.push("Parachutes Deployed");
          }
          return next;
      });
  };

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
     
     // 3. Orbit Line (Moon Orbit)
     ctx.strokeStyle = '#334155';
     ctx.lineWidth = 1 / zoom;
     ctx.beginPath(); ctx.arc(0, 0, MOON_ORBIT_RADIUS, 0, Math.PI*2); ctx.stroke();

     // 4. Current Orbit Prediction
     // Re-calculate basic orbit elements for rendering frame to ensure smoothness
     // Determine active body for drawing
     const distToMoon = vMag({x: state.position.x - moonPos.x, y: state.position.y - moonPos.y});
     const isInMoonSOI = distToMoon < MOON_SOI_RADIUS;
     
     let orbMu = GRAVITATIONAL_PARAM;
     let orbFocus = {x: 0, y: 0};
     let relPos = state.position;
     let relVel = state.velocity;

     if (isInMoonSOI) {
         orbMu = MOON_GRAVITATIONAL_PARAM;
         orbFocus = moonPos;
         // Moon Velocity (Circular approximation)
         const moonSpeed = 2 * Math.PI * MOON_ORBIT_RADIUS / MOON_ORBITAL_PERIOD;
         const moonVelAngle = moonAngle + Math.PI / 2;
         const moonVel = { x: Math.cos(moonVelAngle) * moonSpeed, y: Math.sin(moonVelAngle) * moonSpeed };
         relPos = vSub(state.position, moonPos);
         relVel = vSub(state.velocity, moonVel);
     }

     const r = vMag(relPos);
     const v = vMag(relVel);
     const vSq = v*v;
     const hVecVal = vCrossMag(relPos, relVel); // Angular momentum
     
     // Eccentricity Vector
     const rv = vDot(relPos, relVel);
     const eVec = {
        x: ((vSq - orbMu/r)*relPos.x - rv*relVel.x) / orbMu,
        y: ((vSq - orbMu/r)*relPos.y - rv*relVel.y) / orbMu
    };
    const e = vMag(eVec);
     const energy = vSq/2 - orbMu/r;
     const a = -orbMu / (2*energy);

     ctx.save();
     ctx.translate(orbFocus.x, orbFocus.y);
     
     // Draw Orbit
     if (e < 1 && a > 0) {
         // Ellipse
         const omega = Math.atan2(eVec.y, eVec.x); // Argument of Periapsis
         const b = a * Math.sqrt(1 - e*e);
         const c = a * e; // Distance from center to focus
         
         ctx.rotate(omega);
         ctx.translate(-c, 0); // Center is offset from focus by -ae in direction of periapsis
         
         ctx.strokeStyle = isInMoonSOI ? '#a855f7' : '#3b82f6'; // Purple for moon, Blue for planet
         ctx.lineWidth = 2 / zoom;
         ctx.beginPath();
         ctx.ellipse(0, 0, a, b, 0, 0, 2 * Math.PI);
         ctx.stroke();
         
         // Draw Periapsis/Apoapsis markers
         ctx.fillStyle = '#60a5fa';
         ctx.beginPath(); ctx.arc(a, 0, 4/zoom, 0, Math.PI*2); ctx.fill(); // Apoapsis (relative to center, it's at +a)
         ctx.fillStyle = '#c084fc';
         ctx.beginPath(); ctx.arc(-a, 0, 4/zoom, 0, Math.PI*2); ctx.fill(); // Periapsis (relative to center, it's at -a)
         
     } else {
         // Hyperbola / Parabola (Escape Trajectory)
         const p = (hVecVal*hVecVal) / orbMu;
         const omega = Math.atan2(eVec.y, eVec.x);
         
         ctx.strokeStyle = isInMoonSOI ? '#a855f7' : '#ef4444'; 
         ctx.lineWidth = 2 / zoom;
         ctx.beginPath();
         
         // Angle limit for hyperbola: asymptotes are at arccos(-1/e)
         const limit = Math.acos(-1/e) - 0.1; // Stay slightly inside asymptotes
         
         const steps = 100;
         for(let i = -limit; i <= limit; i += (2*limit)/steps) {
             const r_theta = p / (1 + e * Math.cos(i));
             const lx = r_theta * Math.cos(i);
             const ly = r_theta * Math.sin(i);
             const wx = lx * Math.cos(omega) - ly * Math.sin(omega);
             const wy = lx * Math.sin(omega) + ly * Math.cos(omega);
             
             if (i === -limit) ctx.moveTo(wx, wy);
             else ctx.lineTo(wx, wy);
         }
         ctx.stroke();
     }
     ctx.restore();


     // 5. Rocket Parts
     // Draw Icon if zoomed out
     if (zoom < 0.1) {
         ctx.fillStyle = '#facc15';
         const iconSize = 10 / zoom;
         ctx.beginPath(); ctx.arc(state.position.x, state.position.y, iconSize, 0, Math.PI*2); ctx.fill();
     } else {
         const renderParts = (parts: RocketPart[], x: number, y: number, r: number) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(r);
            const layout = calculateRocketLayout(parts);
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
                
                // Check deployment state for parachutes
                const isDeployed = p.type === PartType.PARACHUTE ? p.isDeployed : false;
                
                drawPartShape(ctx, p.type, p.width, p.height, isDeployed || p.isThrusting); 
                ctx.fill();
                ctx.stroke();

                // Fuel Level Overlay
                if (p.type === PartType.TANK && p.fuelCapacity && p.currentFuel !== undefined) {
                    const fuelRatio = p.currentFuel / p.fuelCapacity;
                    const fuelHeight = p.height * fuelRatio;
                    
                    ctx.save();
                    drawPartShape(ctx, p.type, p.width, p.height, false);
                    ctx.clip();
                    const hh = p.height / 2;
                    const hw = p.width / 2;
                    ctx.fillStyle = 'rgba(6, 182, 212, 0.4)'; 
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
            ctx.restore();
         };
         
         // Active Vessel
         renderParts(state.parts, state.position.x, state.position.y, state.rotation);
         
         // Debris
         state.debris.forEach(deb => {
             renderParts(deb.parts, deb.position.x, deb.position.y, deb.rotation);
         });
     }

     // 6. Force Visualization
     if (zoom > 0.1) {
         ctx.translate(state.position.x, state.position.y);
         const scaleForce = (vec: Vector2) => {
             const m = vMag(vec);
             if (m < 0.1) return {x:0, y:0};
             // Logarithmic scale for visualisation: 50px for 10kN, 100px for 100kN, 150px for 1000kN...
             // Or simpler: Scaled by acceleration (g-force). 1g = 50px line.
             // F/mass = acc. 
             // Let's use acceleration scaling: 20 pixels per m/s^2
             // Total mass? We don't have it here easily in drawFrame without re-calc.
             // Fallback: Fixed logarithmic scale for raw Force.
             const logMag = Math.log10(m + 1); // 1N -> 0.3, 10N -> 1, 100kN -> 5
             const pixelLen = logMag * 15; 
             return vScale(vNorm(vec), pixelLen);
         }

         const drawVector = (vec: Vector2 | undefined, color: string) => {
             if (!vec) return;
             const v = scaleForce(vec);
             if (vMag(v) < 1) return;
             ctx.beginPath();
             ctx.moveTo(0, 0);
             ctx.lineTo(v.x, v.y);
             ctx.strokeStyle = color;
             ctx.lineWidth = 2 / zoom;
             ctx.stroke();
             // Arrowhead
             const headLen = 5 / zoom;
             const angle = Math.atan2(v.y, v.x);
             ctx.beginPath();
             ctx.moveTo(v.x, v.y);
             ctx.lineTo(v.x - headLen * Math.cos(angle - Math.PI / 6), v.y - headLen * Math.sin(angle - Math.PI / 6));
             ctx.lineTo(v.x - headLen * Math.cos(angle + Math.PI / 6), v.y - headLen * Math.sin(angle + Math.PI / 6));
             ctx.fillStyle = color;
             ctx.fill();
         }
         
         if (state.forces) {
             drawVector(state.forces.gravity, '#22c55e'); // Green Gravity
             drawVector(state.forces.drag, '#ef4444');    // Red Drag
             
             // Strict check to only draw thrust if significant (matches logic in updatePhysics)
             const tMag = vMag(state.forces.thrust);
             if (tMag > 1) {
                drawVector(state.forces.thrust, '#f97316');  // Orange Thrust
             }
             
             // Total
             const total = vAdd(vAdd(state.forces.gravity, state.forces.drag), state.forces.thrust);
             drawVector(total, '#ffffff');
         }
     }

     ctx.restore();
  };

  // --- PHYSICS ENGINE ---
  const updatePhysics = () => {
    const currentState = stateRef.current;
    if (!currentState.active || currentState.finished) return;

    let { position, velocity, rotation, angularVelocity, time, parts, events, maxAltitude, debris } = currentState;
    const warp = timeWarpRef.current;
    
    // Run physics steps based on Time Warp
    const steps = Math.max(1, Math.floor(warp)); 
    const maxSteps = 10; 
    const effectiveSteps = Math.min(steps, maxSteps);
    const dt = BASE_TIME_STEP * (steps / effectiveSteps); 

    // Build Connectivity Map for Fuel Flow (BFS)
    const childrenMap = getChildrenMap(parts);

    const getMoonPos = (t: number) => {
         const angle = (t / MOON_ORBITAL_PERIOD) * 2 * Math.PI;
         return { x: Math.cos(angle) * MOON_ORBIT_RADIUS, y: Math.sin(angle) * MOON_ORBIT_RADIUS };
    };

    let lastForces = { thrust: {x:0, y:0}, gravity: {x:0, y:0}, drag: {x:0, y:0} };

    for(let s = 0; s < effectiveSteps; s++) {
        const moonPosStart = getMoonPos(time);

        // 2. Mass Properties & Drag Area
        let mass = 0;
        let momentOfInertia = 0;
        let dragArea = 0;
        
        parts.forEach(p => {
            const m = p.mass + (p.currentFuel || 0);
            mass += m;
            let area = p.width * p.width;
            if (p.type === PartType.PARACHUTE && p.isDeployed) area *= 50; 
            dragArea += area; 
            momentOfInertia += m * 10; 
        });
        momentOfInertia = Math.max(momentOfInertia, 100);

        // 3. Calculate Thrust (Mutates Fuel!)
        let totalThrust = 0;
        const currentThrottle = stateRef.current.throttle;
        
        // Strict threshold to avoid floating point phantom thrust
        if (currentThrottle > 0.001) {
            parts.forEach(p => {
                if (p.type === PartType.ENGINE) {
                    const isBlocked = isEngineBlockedByStage(p, childrenMap);
                    
                    if (!isBlocked) {
                        const maxT = p.thrust || 0;
                        if (maxT > 0) {
                            const requiredFuel = (p.burnRate || 0) * currentThrottle * dt;
                            const allPossibleSources = findFuelSources(p, parts, childrenMap);
                            const fuelSources = allPossibleSources.filter(s => (s.part.currentFuel || 0) > 0.000001); 
                            let totalFuelAvailable = fuelSources.reduce((sum, s) => sum + (s.part.currentFuel || 0), 0);

                            if (totalFuelAvailable >= requiredFuel && requiredFuel > 0) {
                                let remainingBurn = requiredFuel;
                                const groups = new Map<number, RocketPart[]>();
                                fuelSources.forEach(s => {
                                    if (!groups.has(s.dist)) groups.set(s.dist, []);
                                    groups.get(s.dist)!.push(s.part);
                                });
                                const sortedDistances = Array.from(groups.keys()).sort((a, b) => b - a);

                                for (const dist of sortedDistances) {
                                    if (remainingBurn <= 0) break;
                                    const tanks = groups.get(dist)!;
                                    const groupTotal = tanks.reduce((sum, t) => sum + (t.currentFuel || 0), 0);
                                    const take = Math.min(groupTotal, remainingBurn);
                                    if (groupTotal > 0) {
                                        tanks.forEach(t => {
                                            const fraction = (t.currentFuel || 0) / groupTotal;
                                            const amount = take * fraction;
                                            t.currentFuel = Math.max(0, (t.currentFuel || 0) - amount);
                                        });
                                    }
                                    remainingBurn -= take;
                                }
                                totalThrust += maxT * currentThrottle;
                                p.isThrusting = true;
                            } else if (totalFuelAvailable > 0) {
                                fuelSources.forEach(s => s.part.currentFuel = 0);
                                const ratio = requiredFuel > 0 ? totalFuelAvailable / requiredFuel : 0;
                                totalThrust += maxT * currentThrottle * ratio;
                                p.isThrusting = ratio > 0.01;
                            } else {
                                p.isThrusting = false;
                            }
                        }
                    } else { p.isThrusting = false; }
                } else { p.isThrusting = false; }
            });
        } else {
            parts.forEach(p => p.isThrusting = false);
        }

        console.log(totalThrust);

        const thrustDir = { x: Math.sin(rotation), y: -Math.cos(rotation) }; 
        const thrustVec = vScale(thrustDir, totalThrust);

        // Helper to Calculate Environmental Forces (Patched Conics)
        const getForces = (pos: Vector2, vel: Vector2, mPos: Vector2, area: number = 10) => {
             // Gravity Planet
             const r2 = pos.x*pos.x + pos.y*pos.y;
             const r = Math.sqrt(r2);
             const fGravityP = -GRAVITATIONAL_PARAM / r2; 
             const gVecP = { x: fGravityP * (pos.x/r), y: fGravityP * (pos.y/r) };

             // Gravity Moon
             const dMx = pos.x - mPos.x;
             const dMy = pos.y - mPos.y;
             const rm2 = dMx*dMx + dMy*dMy;
             const rm = Math.sqrt(rm2);
             const fGravityM = -MOON_GRAVITATIONAL_PARAM / rm2;
             const gVecM = { x: fGravityM * (dMx/rm), y: fGravityM * (dMy/rm) };

             // Atmosphere Drag
             const altitudeSea = r - PLANET_RADIUS;
             let density = 0;
             if (altitudeSea < ATMOSPHERE_HEIGHT) {
                 density = 1.225 * Math.exp(-altitudeSea / 7000);
             }
             
             let dragVec = { x: 0, y: 0 };
             const speedSq = vDot(vel, vel);
             const speed = Math.sqrt(speedSq);
             if (density > 0 && speed > 0.1) {
                  const dragMag = 0.5 * density * speedSq * area * 0.2; 
                  const velDir = vNorm(vel);
                  dragVec = vScale(velDir, -dragMag);
             }

             // PATCHED CONICS: Only apply gravity of the SOI we are in
             let gravity = gVecP;
             const distMoon = vMag(vSub(pos, mPos));
             if (distMoon < MOON_SOI_RADIUS) {
                 gravity = gVecM;
             }

             return {
                 gravity,
                 drag: dragVec
             };
        };

        // --- STRICT VELOCITY VERLET INTEGRATION ---
        
        // 1. Forces at Start (t)
        const forces1 = getForces(position, velocity, moonPosStart, dragArea);
        const totalF1 = vAdd(vAdd(forces1.gravity, forces1.drag), thrustVec);
        const accel1 = vScale(totalF1, 1/mass);

        // 2. Half-Step Velocity
        const vHalf = vAdd(velocity, vScale(accel1, 0.5 * dt));

        // 3. Full-Step Position
        const nextPos = vAdd(position, vScale(vHalf, dt));

        // 4. Update Time
        time += dt;
        const moonPosEnd = getMoonPos(time);

        // 5. Rotation Update (Standard Euler)
        let controlTorque = 0;
        if (keysRef.current.left) controlTorque -= 10000;
        if (keysRef.current.right) controlTorque += 10000;
        
        const sas = stateRef.current.sasMode;
        if (sas !== SASMode.MANUAL) {
            let target = targetRotation;
            const speed = vMag(velocity);
            if (sas === SASMode.PROGRADE && speed > 1) {
                target = Math.atan2(velocity.y, velocity.x) + Math.PI/2;
            } else if (sas === SASMode.RETROGRADE && speed > 1) {
                target = Math.atan2(velocity.y, velocity.x) - Math.PI/2;
            } else if (sas === SASMode.STABILITY) {
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

        // Recalculate Thrust Vector for End Step (if rotation changed)
        const thrustDirNext = { x: Math.sin(rotation), y: -Math.cos(rotation) }; 
        const thrustVecNext = vScale(thrustDirNext, totalThrust);

        // 6. Forces at End (t+dt) using vHalf approximation for drag
        const forces2 = getForces(nextPos, vHalf, moonPosEnd, dragArea);
        const totalF2 = vAdd(vAdd(forces2.gravity, forces2.drag), thrustVecNext);
        const accel2 = vScale(totalF2, 1/mass);

        // 7. Full-Step Velocity
        velocity = vAdd(vHalf, vScale(accel2, 0.5 * dt));
        position = nextPos;
        
        lastForces = { ...forces2, thrust: thrustVecNext };

        // --- DEBRIS PHYSICS (Simplified Euler) ---
        debris.forEach(d => {
             // Basic Gravity
             const fDebris = getForces(d.position, d.velocity, moonPosEnd, 5); 
             const fTotal = vAdd(fDebris.gravity, fDebris.drag);
             const a = vScale(fTotal, 1/500); // Approximate mass 500kg
             d.velocity = vAdd(d.velocity, vScale(a, dt));
             d.position = vAdd(d.position, vScale(d.velocity, dt));
             d.rotation += d.angularVelocity * dt;
        });

        // 8. Collisions
        // Planet Surface
        if (vMag(position) <= PLANET_RADIUS) {
            const radialVel = vDot(velocity, vNorm(position));
            
            if (radialVel < -10) {
                 events.push(`Crashed into Planet`);
                 currentState.active = false;
                 currentState.finished = true;
            } else if (vMag(velocity) < 1) {
                 if (maxAltitude > 50) {
                     events.push("Landed on Planet");
                     currentState.active = false;
                     currentState.finished = true;
                 } else {
                     position = vScale(vNorm(position), PLANET_RADIUS);
                     velocity = { x: 0, y: 0 };
                 }
            } else {
                 position = vScale(vNorm(position), PLANET_RADIUS);
                 if (radialVel < 0) {
                     const tangent = { x: -position.y, y: position.x };
                     const tMag = vMag(tangent);
                     const tNorm = tMag > 0 ? vScale(tangent, 1/tMag) : {x:0, y:0};
                     const tVel = vDot(velocity, tNorm);
                     velocity = vScale(tNorm, tVel);
                 }
            }
        }
        
        // Moon Surface
        if (vMag({x: position.x - moonPosEnd.x, y: position.y - moonPosEnd.y}) <= MOON_RADIUS) {
             const dMx = position.x - moonPosEnd.x;
             const dMy = position.y - moonPosEnd.y;
             const radialVel = vDot(velocity, vNorm({x: dMx, y: dMy}));
             
             if (radialVel < -10) {
                 events.push(`Crashed into Moon`);
                 currentState.active = false;
                 currentState.finished = true;
             } else {
                 events.push("THE EAGLE HAS LANDED!");
                 currentState.active = false;
                 currentState.finished = true;
                 position = vAdd(moonPosEnd, vScale(vNorm({x: dMx, y: dMy}), MOON_RADIUS));
                 velocity = { x: 0, y: 0 }; 
             }
        }
    }

    // --- ORBITAL MECHANICS ---
    // Calculate elements relative to the current SOI
    const moonAngle = (time / MOON_ORBITAL_PERIOD) * 2 * Math.PI;
    const moonPos = { x: Math.cos(moonAngle) * MOON_ORBIT_RADIUS, y: Math.sin(moonAngle) * MOON_ORBIT_RADIUS };
    const distToMoon = vMag({x: position.x - moonPos.x, y: position.y - moonPos.y});
    const isInMoonSOI = distToMoon < MOON_SOI_RADIUS;

    let orbMu = GRAVITATIONAL_PARAM;
    let relPos = position;
    let relVel = velocity;
    let bodyRadius = PLANET_RADIUS;

    if (isInMoonSOI) {
        orbMu = MOON_GRAVITATIONAL_PARAM;
        const moonSpeed = 2 * Math.PI * MOON_ORBIT_RADIUS / MOON_ORBITAL_PERIOD;
        const moonVelAngle = moonAngle + Math.PI / 2;
        const moonVel = { x: Math.cos(moonVelAngle) * moonSpeed, y: Math.sin(moonVelAngle) * moonSpeed };
        relPos = vSub(position, moonPos);
        relVel = vSub(velocity, moonVel);
        bodyRadius = MOON_RADIUS;
    }

    const r = vMag(relPos);
    const v = vMag(relVel);
    const vSq = v*v;
    
    const radDir = vNorm(relPos);
    const vVert = vDot(relVel, radDir);
    const vHoriz = Math.sqrt(Math.max(0, vSq - vVert*vVert));

    const specificEnergy = vSq/2 - orbMu/r;
    const sma = -orbMu / (2 * specificEnergy);

    // Eccentricity Vector
    const rv = vDot(relPos, relVel);
    const eVec = {
        x: ((vSq - orbMu/r)*relPos.x - rv*relVel.x) / orbMu,
        y: ((vSq - orbMu/r)*relPos.y - rv*relVel.y) / orbMu
    };
    const ecc = vMag(eVec);
    
    let apo = 0;
    let peri = 0;

    if (ecc < 1) {
        peri = sma * (1 - ecc) - bodyRadius;
        apo = sma * (1 + ecc) - bodyRadius;
    } else {
        // Hyperbolic
        peri = sma * (1 - ecc) - bodyRadius; // sma is negative, (1-ecc) negative => positive radius
        apo = NaN;
    }

    // Telemetry Update
    const distCenter = vMag(position);
    const altitude = distCenter - PLANET_RADIUS;
    
    stateRef.current = {
        ...currentState,
        position, velocity, rotation, angularVelocity, time, maxAltitude: Math.max(maxAltitude, altitude), events, parts,
        altitude,
        velocityMag: vMag(velocity),
        verticalVelocity: vVert,
        horizontalVelocity: vHoriz,
        semiMajorAxis: sma,
        eccentricity: ecc,
        apoapsis: apo,
        periapsis: peri,
        debris,
        forces: lastForces
    };
    
    setSimState(stateRef.current);
  };

  // Game Loop
  useEffect(() => {
    const loop = () => {
        updatePhysics();
        drawFrame();
        requestRef.current = requestAnimationFrame(loop);
    };
    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, []);

  // Window Resize
  useEffect(() => {
    const handleResize = () => {
        if (canvasRef.current) {
            canvasRef.current.width = window.innerWidth;
            canvasRef.current.height = window.innerHeight;
        }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // UI Helpers
  const formatAlt = (m: number) => m > 1000000 ? `${(m/1000000).toFixed(2)} Mm` : m > 1000 ? `${(m/1000).toFixed(1)} km` : `${m.toFixed(0)} m`;
  const formatVel = (ms: number) => `${ms.toFixed(0)} m/s`;

  // Calculate Fuel per stage for display
  const stageFuelData = useMemo(() => {
      // Re-use logic from builder to group current active parts by stage
      const map = assignStages(simState.parts);
      const stages = new Map<number, { current: number, max: number }>();
      
      simState.parts.forEach(p => {
          const sIdx = map.get(p.instanceId) || 0;
          if (!stages.has(sIdx)) stages.set(sIdx, { current: 0, max: 0 });
          
          if (p.fuelCapacity) {
              const entry = stages.get(sIdx)!;
              entry.max += p.fuelCapacity;
              entry.current += (p.currentFuel || 0);
          }
      });
      
      // Convert to array and sort descending (Launch stage usually highest number)
      return Array.from(stages.entries())
          .filter(([_, data]) => data.max > 0)
          .sort((a, b) => b[0] - a[0])
          .map(([stage, data]) => ({ stage, ...data }));
  }, [simState.parts]); 

  const handleStage = () => {
    const currentParts = stateRef.current.parts;
    const stageMap = assignStages(currentParts);
    let maxStage = 0;
    for(const s of stageMap.values()) maxStage = Math.max(maxStage, s);

    if (maxStage === 0) {
        // Final stage: Deploy parachutes
        deployParachutes();
        return;
    }

    const stageParts = currentParts.filter(p => stageMap.get(p.instanceId) === maxStage);
    const stagePartIds = new Set(stageParts.map(p => p.instanceId));

    // Fix parentIds for debris root(s)
    const debrisParts = stageParts.map(p => {
        const pCopy = { ...p, isThrusting: false };
        // If parent is not in this debris chunk, it's a root of the debris
        if (p.parentId && !stagePartIds.has(p.parentId)) {
            pCopy.parentId = undefined;
        }
        return pCopy;
    });

    // Create debris from the separated parts
    const debrisObj = {
        id: Math.random().toString(36),
        parts: debrisParts,
        position: { ...stateRef.current.position },
        velocity: { ...stateRef.current.velocity }, // Inherit velocity
        rotation: stateRef.current.rotation,
        angularVelocity: stateRef.current.angularVelocity
    };
    
    // Remove from active vessel
    const nextParts = currentParts.filter(p => !stagePartIds.has(p.instanceId));
    
    setActiveParts(nextParts);
    
    // We manually push to debris in ref because debris is not in React state 'activeParts'
    stateRef.current.debris.push(debrisObj);
    stateRef.current.events.push(`Stage ${maxStage} separated`);
  };

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden select-none font-mono">
        <canvas ref={canvasRef} className="block w-full h-full" />
        
        {/* Top Left: Telemetry */}
        <div className="absolute top-4 left-4 flex flex-col space-y-2 pointer-events-none">
            <div className="bg-slate-900/80 border border-slate-700 p-3 rounded-lg backdrop-blur-sm min-w-[200px]">
                <div className="text-xs text-slate-400 mb-1">ALTITUDE</div>
                <div className="text-2xl font-bold text-cyan-400">{formatAlt(simState.altitude)}</div>
                <div className="h-px bg-slate-700 my-2"></div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="text-xs text-slate-400">VELOCITY</span>
                    <span className="font-bold text-yellow-400">{formatVel(simState.velocityMag)}</span>
                </div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="text-xs text-slate-400">VERT SPD</span>
                    <span className={`font-bold ${simState.verticalVelocity > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatVel(simState.verticalVelocity)}
                    </span>
                </div>
            </div>

             <div className="bg-slate-900/80 border border-slate-700 p-3 rounded-lg backdrop-blur-sm">
                <div className="flex justify-between items-baseline space-x-4">
                    <span className="text-xs text-slate-400">APOAPSIS</span>
                    <span className="font-mono text-blue-300">{formatAlt(simState.apoapsis)}</span>
                </div>
                 <div className="flex justify-between items-baseline space-x-4">
                    <span className="text-xs text-slate-400">PERIAPSIS</span>
                    <span className="font-mono text-purple-300">{formatAlt(simState.periapsis)}</span>
                </div>
             </div>

             {/* Fuel Gauge Box */}
             {stageFuelData.length > 0 && (
                <div className="bg-slate-900/80 border border-slate-700 p-3 rounded-lg backdrop-blur-sm min-w-[200px]">
                     <div className="text-[10px] text-slate-500 uppercase font-bold border-b border-slate-700 pb-1 mb-2">Stage Fuel</div>
                     {stageFuelData.map(s => (
                         <div key={s.stage} className="mb-2 last:mb-0">
                             <div className="flex justify-between text-[10px] mb-0.5">
                                 <span className="text-slate-300">Stage {stageFuelData.length > 1 ? s.stage : 'Current'}</span>
                                 <span className="font-mono text-slate-400">{Math.round((s.current/s.max)*100)}%</span>
                             </div>
                             <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
                                 <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${(s.current/s.max)*100}%` }}></div>
                             </div>
                         </div>
                     ))}
                </div>
             )}
        </div>

        {/* Top Right: Time & System */}
        <div className="absolute top-4 right-4 flex flex-col items-end space-y-2 pointer-events-auto">
            <div className="flex items-center space-x-1 bg-slate-900/80 p-1 rounded-lg border border-slate-700 backdrop-blur-sm text-slate-200">
                <button onClick={() => setTimeWarp(w => Math.max(1, w > 5 ? w/2 : w-1))} className="p-2 hover:bg-slate-700 rounded"><ArrowDownCircle size={20}/></button>
                <div className="w-16 text-center font-bold text-sm">
                    {timeWarp}x
                </div>
                <button onClick={() => setTimeWarp(w => Math.min(100, w === 0 ? 1 : w < 5 ? w+1 : w*2))} className="p-2 hover:bg-slate-700 rounded"><ArrowUpCircle size={20}/></button>
            </div>
             <button onClick={onExit} className="bg-red-600 hover:bg-red-500 text-white p-2 rounded-lg font-bold shadow-lg flex items-center">
                <X size={18} className="mr-2"/> ABORT
            </button>
        </div>
        
        {/* Top Center: Mission Timer & Events */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
             <div className="bg-slate-900/80 px-4 py-1 rounded-full border border-slate-700 text-yellow-500 font-mono font-bold text-xl mb-2">
                 T+ {Math.floor(simState.time / 60).toString().padStart(2, '0')}:{(simState.time % 60).toFixed(1).padStart(4, '0')}
             </div>
             {simState.events.length > 0 && (
                 <div className="bg-blue-900/80 text-blue-200 px-3 py-1 rounded text-sm animate-pulse">
                     {simState.events[simState.events.length-1]}
                 </div>
             )}
             {simState.finished && (
                 <div className="mt-4 bg-slate-900/90 border-2 border-green-500 p-6 rounded-xl text-center pointer-events-auto">
                     <h2 className="text-2xl font-bold text-white mb-2">MISSION ENDED</h2>
                     <p className="text-slate-300 mb-4">{simState.events[simState.events.length-1]}</p>
                     <button onClick={onExit} className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg font-bold">Return to VAB</button>
                 </div>
             )}
        </div>

        {/* Bottom Left: Camera/Focus Controls */}
        <div className="absolute bottom-4 left-4 bg-slate-900/80 p-2 rounded-lg border border-slate-700 backdrop-blur-sm flex flex-col space-y-2 text-slate-200 pointer-events-auto">
            <div className="text-[10px] text-slate-500 uppercase font-bold px-1">Camera Focus</div>
            <button onClick={() => setFocusBody('ROCKET')} className={`px-3 py-1 rounded text-xs font-bold ${focusBody === 'ROCKET' ? 'bg-indigo-600' : 'hover:bg-slate-700'}`}>ROCKET</button>
            <button onClick={() => setFocusBody('PLANET')} className={`px-3 py-1 rounded text-xs font-bold ${focusBody === 'PLANET' ? 'bg-indigo-600' : 'hover:bg-slate-700'}`}>KERBIN</button>
            <button onClick={() => setFocusBody('MOON')} className={`px-3 py-1 rounded text-xs font-bold ${focusBody === 'MOON' ? 'bg-indigo-600' : 'hover:bg-slate-700'}`}>MUN</button>
        </div>

        {/* Bottom Center: Controls */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-end space-x-4 pointer-events-auto">
             {/* Staging/Throttle */}
             <div className="flex flex-col items-center bg-slate-900/80 p-3 rounded-xl border border-slate-700 backdrop-blur-sm">
                 <div className="h-32 w-8 bg-slate-800 rounded-full relative overflow-hidden border border-slate-600">
                     <div className="absolute bottom-0 left-0 right-0 bg-orange-500 transition-all duration-100 ease-linear" style={{ height: `${throttle * 100}%` }}></div>
                     {/* Ticks */}
                     {[0, 25, 50, 75, 100].map(t => (
                         <div key={t} className="absolute w-full h-px bg-slate-500" style={{ bottom: `${t}%` }}></div>
                     ))}
                 </div>
                 <div className="mt-2 text-xs font-bold text-slate-400">THROTTLE</div>
                 <div className="font-mono text-orange-400">{(throttle * 100).toFixed(0)}%</div>
             </div>
             
             {/* NavBall */}
             <div className="relative group">
                <NavBall 
                    rotation={simState.rotation} 
                    velocity={simState.velocity} 
                    sasMode={sasMode} 
                    nearestBodyAngle={Math.atan2(simState.position.y, simState.position.x)} 
                />
             </div>
             
             {/* SAS Panel */}
             <div className="flex flex-col space-y-2 bg-slate-900/80 p-2 rounded-xl border border-slate-700 backdrop-blur-sm text-slate-200">
                 <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-500">SAS CONTROL</span>
                    <div className={`w-2 h-2 rounded-full ${sasMode !== SASMode.MANUAL ? 'bg-green-500' : 'bg-red-500'}`}></div>
                 </div>
                 <div className="grid grid-cols-2 gap-1">
                     <button onClick={() => setSasMode(SASMode.STABILITY)} className={`p-1.5 rounded text-xs font-bold ${sasMode === SASMode.STABILITY ? 'bg-cyan-600' : 'bg-slate-700 hover:bg-slate-600'}`} title="Stability Assist">STAB</button>
                     <button onClick={() => setSasMode(SASMode.MANUAL)} className={`p-1.5 rounded text-xs font-bold ${sasMode === SASMode.MANUAL ? 'bg-yellow-600' : 'bg-slate-700 hover:bg-slate-600'}`} title="Manual Control">MAN</button>
                     <button onClick={() => setSasMode(SASMode.PROGRADE)} className={`p-1.5 rounded text-xs font-bold ${sasMode === SASMode.PROGRADE ? 'bg-green-600' : 'bg-slate-700 hover:bg-slate-600'}`} title="Prograde">PRO</button>
                     <button onClick={() => setSasMode(SASMode.RETROGRADE)} className={`p-1.5 rounded text-xs font-bold ${sasMode === SASMode.RETROGRADE ? 'bg-red-600' : 'bg-slate-700 hover:bg-slate-600'}`} title="Retrograde">RETR</button>
                 </div>
                 <button onClick={deployParachutes} className="mt-2 w-full py-1 bg-indigo-900 hover:bg-indigo-800 border border-indigo-500/50 rounded text-indigo-200 text-xs font-bold flex justify-center items-center">
                     <Umbrella size={14} className="mr-1"/> CHUTES
                 </button>
                 <button onClick={handleStage} className="mt-1 w-full py-2 bg-yellow-600 hover:bg-yellow-500 rounded text-white text-xs font-bold flex justify-center items-center shadow-lg">
                     <Layers size={14} className="mr-1"/> STAGE
                 </button>
             </div>
        </div>
        
        {/* Controls Help */}
        <div className="absolute bottom-4 right-4 text-[10px] text-slate-500 bg-slate-900/80 p-2 rounded border border-slate-800 pointer-events-none">
            <div>Shift/Ctrl: Throttle</div>
            <div>Arrows: Turn</div>
            <div>T: Toggle SAS</div>
            <div>Z/X: Max/Cut Throttle</div>
            <div>./,: Time Warp</div>
        </div>
    </div>
  );
};