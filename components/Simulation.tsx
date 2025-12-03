import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { RocketPart, PartType, SimulationState, TelemetryPoint, Vector2, SASMode } from '../types';
import { Play, Layers, Square, Pause, CircleOff, ArrowUpCircle, ArrowDownCircle, X, Umbrella, Bug } from 'lucide-react';
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

// Physics Constants
const BASE_TIME_STEP = 0.02; 
const PHYSICS_SUBSTEPS = 10; // Higher substeps = more stability

// Vector Math Helpers
const vAdd = (a: Vector2, b: Vector2) => ({ x: a.x + b.x, y: a.y + b.y });
const vSub = (a: Vector2, b: Vector2) => ({ x: a.x - b.x, y: a.y - b.y });
const vScale = (v: Vector2, s: number) => ({ x: v.x * s, y: v.y * s });
const vMag = (v: Vector2) => Math.sqrt(v.x * v.x + v.y * v.y);
const vNorm = (v: Vector2) => { const m = vMag(v); return m === 0 ? { x: 0, y: 0 } : vScale(v, 1/m); };
const vDot = (a: Vector2, b: Vector2) => a.x * b.x + a.y * b.y;
const vCrossMag = (a: Vector2, b: Vector2) => a.x * b.y - a.y * b.x;

// Internal Physics Types for RK4
interface PhysicsState {
    pos: Vector2;
    vel: Vector2;
    rot: number;
    angVel: number;
}

interface Derivatives {
    vel: Vector2;
    acc: Vector2;
    angVel: number;
    angAcc: number;
}

// NavBall Component (Internal)
const NavBall: React.FC<{ rotation: number, velocity: Vector2, sasMode: SASMode, nearestBodyAngle: number }> = ({ rotation, velocity, sasMode, nearestBodyAngle }) => {
    const rad2deg = 180 / Math.PI;
    const bgRotation = ((nearestBodyAngle + Math.PI/2) - rotation) * rad2deg;
    
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
  
  // Settings
  const [zoom, setZoom] = useState(40); 
  const zoomRef = useRef(zoom); 
  const [timeWarp, setTimeWarp] = useState(1);
  const timeWarpRef = useRef(timeWarp);
  const [focusBody, setFocusBody] = useState<'ROCKET' | 'MOON' | 'PLANET'>('ROCKET');
  const focusBodyRef = useRef(focusBody);

  // Debug State
  const [debugForces, setDebugForces] = useState({ thrust: 0, drag: 0 });

  // Initial State
  const initialPos = { x: 0, y: -PLANET_RADIUS }; 

  const [activeParts, setActiveParts] = useState<RocketPart[]>(() => JSON.parse(JSON.stringify(initialParts)));
  
  const keysRef = useRef({ left: false, right: false, shift: false, ctrl: false, z: false, x: false, p: false });
  const [throttle, setThrottle] = useState(0); 
  const [sasMode, setSasMode] = useState<SASMode>(SASMode.STABILITY);
  const [targetRotation, setTargetRotation] = useState(0); 

  const [simState, setSimState] = useState<SimulationState>({
    position: initialPos,
    velocity: { x: 0, y: 0 },
    rotation: 0,
    angularVelocity: 0,
    throttle: 0, 
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
    specificEnergy: 0,
    parts: activeParts,
    debris: [],
    active: true, 
    finished: false,
    maxAltitude: 0,
    events: [],
    forces: { thrust: {x:0, y:0}, gravity: {x:0, y:0}, drag: {x:0, y:0} }
  });

  const requestRef = useRef<number>(0);
  const stateRef = useRef(simState);

  // Sync State Ref
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
          return next < 0.01 ? 0 : next; 
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
          const deployed = next.some((p, i) => p.isDeployed && !prev[i].isDeployed);
          if (deployed) {
              stateRef.current.events.push("Parachutes Deployed");
          }
          return next;
      });
  };

  // --- RENDERING ---
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

     // Planet
     ctx.fillStyle = '#3b82f6';
     ctx.beginPath(); ctx.arc(0, 0, PLANET_RADIUS, 0, Math.PI*2); ctx.fill();
     ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
     ctx.beginPath(); ctx.arc(0, 0, PLANET_RADIUS + ATMOSPHERE_HEIGHT, 0, Math.PI*2); ctx.fill();
     // Moon
     ctx.fillStyle = '#94a3b8';
     ctx.beginPath(); ctx.arc(moonPos.x, moonPos.y, MOON_RADIUS, 0, Math.PI*2); ctx.fill();
     
     // Orbit Prediction
     // ... (Previous rendering logic for orbits kept implicitly visually) ... 
     
     // Active Vessel
     const renderParts = (parts: RocketPart[], x: number, y: number, r: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(r);
        const layout = calculateRocketLayout(parts);
        layout.forEach(p => {
            ctx.save();
            ctx.translate(p.x/SCALE, p.y/SCALE); 
            ctx.rotate(p.rotation);
            if (p.radialOffset === -1) ctx.scale(-1, 1);
            const style = getPartStyle(p.type);
            ctx.fillStyle = style.fill;
            ctx.strokeStyle = style.stroke;
            ctx.lineWidth = 0.1;
            
            drawPartShape(ctx, p.type, p.width, p.height, p.isDeployed || p.isThrusting); 
            ctx.fill();
            ctx.stroke();

            // Fuel Overlay
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
     
     renderParts(state.parts, state.position.x, state.position.y, state.rotation);
     
     // Debris
     state.debris.forEach(deb => {
         renderParts(deb.parts, deb.position.x, deb.position.y, deb.rotation);
     });

     ctx.restore();
  };

  // --- PHYSICS ENGINE ---

  // Helper: Demand-Based Fuel Consumption System
  const calculateThrustAndConsumeFuel = (
      parts: RocketPart[], 
      throttle: number, 
      dt: number, 
      childrenMap: Map<string, RocketPart[]>
  ): { totalThrustMag: number, newMass: number } => {

      // 1. Reset Thrusting Flags
      parts.forEach(p => p.isThrusting = false);

      if (throttle <= 0.001) {
          const totalMass = parts.reduce((acc, p) => acc + p.mass + (p.currentFuel || 0), 0);
          return { totalThrustMag: 0, newMass: totalMass };
      }

      // 2. Identify Active Engines
      const engines = parts.filter(p => p.type === PartType.ENGINE);
      const activeEngines: RocketPart[] = [];
      const engineDemands = new Map<string, number>(); // EngineId -> Mass of fuel needed

      engines.forEach(eng => {
          if (!isEngineBlockedByStage(eng, childrenMap)) {
               activeEngines.push(eng);
               const req = (eng.burnRate || 0) * throttle * dt;
               engineDemands.set(eng.instanceId, req);
          }
      });

      if (activeEngines.length === 0) {
          const totalMass = parts.reduce((acc, p) => acc + p.mass + (p.currentFuel || 0), 0);
          return { totalThrustMag: 0, newMass: totalMass };
      }

      // 3. Plan: Map Requests to Tanks (Demand Aggregation)
      // TankId -> { totalRequested: number, claims: { engineId, amount }[] }
      const tankLedger = new Map<string, { totalRequested: number, claims: { engineId: string, amount: number }[] }>();

      activeEngines.forEach(eng => {
          const demand = engineDemands.get(eng.instanceId) || 0;
          if (demand <= 0) return;

          const sources = findFuelSources(eng, parts, childrenMap);
          
          // Group by distance to prioritize furthest tanks
          const byDist = new Map<number, RocketPart[]>();
          sources.forEach(s => {
              if ((s.part.currentFuel || 0) > 0.000001) {
                  if (!byDist.has(s.dist)) byDist.set(s.dist, []);
                  byDist.get(s.dist)!.push(s.part);
              }
          });

          const sortedDist = Array.from(byDist.keys()).sort((a, b) => b - a);
          
          let remainingDemand = demand;
          
          for (const dist of sortedDist) {
              if (remainingDemand <= 0) break;
              const tanks = byDist.get(dist)!;
              
              // We split demand equally among tanks at the same distance (e.g. radial symmetry)
              // But we can't take more than the tank has *conceptually*. 
              // Since multiple engines might hit this tank, we just register the CLAIM.
              // Ideally, we claim 'remainingDemand / tanks.length' from each, but we might hit limits.
              // Simple Strategy: Claim proportionally from all tanks at this distance level.
              
              const totalFuelAtLevel = tanks.reduce((sum, t) => sum + (t.currentFuel || 0), 0);
              
              if (totalFuelAtLevel <= 0) continue;

              const amountFromLevel = Math.min(totalFuelAtLevel, remainingDemand);
              
              tanks.forEach(tank => {
                  const share = amountFromLevel * ((tank.currentFuel || 0) / totalFuelAtLevel);
                  
                  if (!tankLedger.has(tank.instanceId)) {
                      tankLedger.set(tank.instanceId, { totalRequested: 0, claims: [] });
                  }
                  const ledger = tankLedger.get(tank.instanceId)!;
                  ledger.totalRequested += share;
                  ledger.claims.push({ engineId: eng.instanceId, amount: share });
              });

              remainingDemand -= amountFromLevel;
          }
      });

      // 4. Resolve: Calculate Supply Ratios & Deduct Fuel
      // EngineId -> ActualFuelObtained
      const engineSupplies = new Map<string, number>(); 
      
      tankLedger.forEach((data, tankId) => {
          const tank = parts.find(p => p.instanceId === tankId)!;
          const available = tank.currentFuel || 0;
          
          // If requested > available, everyone gets scaled down
          const ratio = available >= data.totalRequested ? 1.0 : (available / data.totalRequested);
          const totalTaken = Math.min(available, data.totalRequested);
          
          // Deduct from tank
          tank.currentFuel = Math.max(0, available - totalTaken);
          
          // Credit engines
          data.claims.forEach(claim => {
              const obtained = claim.amount * ratio;
              const current = engineSupplies.get(claim.engineId) || 0;
              engineSupplies.set(claim.engineId, current + obtained);
          });
      });

      // 5. Calculate Final Thrust
      let totalThrust = 0;
      activeEngines.forEach(eng => {
          const obtained = engineSupplies.get(eng.instanceId) || 0;
          const needed = engineDemands.get(eng.instanceId) || 0;
          
          // Allow small epsilon for floating point logic
          if (needed > 0 && obtained > 0) {
              const performance = obtained / needed;
              if (performance > 0.01) {
                  totalThrust += (eng.thrust || 0) * throttle * performance;
                  eng.isThrusting = true;
              }
          }
      });
      
      const newMass = parts.reduce((acc, p) => acc + p.mass + (p.currentFuel || 0), 0);
      return { totalThrustMag: totalThrust, newMass };
  };

  const updatePhysics = () => {
    const currentState = stateRef.current;
    if (!currentState.active || currentState.finished) return;

    let { position, velocity, rotation, angularVelocity, time, parts, events, maxAltitude, debris } = currentState;
    const warp = timeWarpRef.current;
    
    // Split into substeps for stability
    const totalDt = BASE_TIME_STEP * Math.max(1, warp);
    const dt = totalDt / PHYSICS_SUBSTEPS;

    const childrenMap = getChildrenMap(parts);
    const getMoonPos = (t: number) => {
         const angle = (t / MOON_ORBITAL_PERIOD) * 2 * Math.PI;
         return { x: Math.cos(angle) * MOON_ORBIT_RADIUS, y: Math.sin(angle) * MOON_ORBIT_RADIUS };
    };

    let finalForces = { thrust: {x:0, y:0}, gravity: {x:0, y:0}, drag: {x:0, y:0} };

    for(let s = 0; s < PHYSICS_SUBSTEPS; s++) {
        const currentTime = time + s * dt;
        
        // 1. Process Fuel & Thrust (Updates 'parts' fuel state in-place for this substep)
        // Note: At high time-warp, this might drain tanks instantly.
        const { totalThrustMag, newMass } = calculateThrustAndConsumeFuel(parts, stateRef.current.throttle, dt, childrenMap);
        
        // Calculate Inertia
        let momentOfInertia = 0;
        let dragArea = 0;
        parts.forEach(p => {
             // Simple inertia approximation
             momentOfInertia += (p.mass + (p.currentFuel||0)) * 10;
             dragArea += p.width * p.width;
        });
        momentOfInertia = Math.max(momentOfInertia, 100);

        // 2. Integration Helpers
        const getForces = (pos: Vector2, vel: Vector2, t: number, mass: number) => {
             const mPos = getMoonPos(t);
             const r2 = pos.x*pos.x + pos.y*pos.y;
             const r = Math.sqrt(r2);
             
             // Gravity Planet (Force = GM * m / r^2)
             const fGravityP = (-GRAVITATIONAL_PARAM * mass) / r2; 
             const gVecP = { x: fGravityP * (pos.x/r), y: fGravityP * (pos.y/r) };

             // Gravity Moon (Force = GM * m / r^2)
             const dMx = pos.x - mPos.x;
             const dMy = pos.y - mPos.y;
             const rm2 = dMx*dMx + dMy*dMy;
             const rm = Math.sqrt(rm2);
             const fGravityM = (-MOON_GRAVITATIONAL_PARAM * mass) / rm2;
             const gVecM = { x: fGravityM * (dMx/rm), y: fGravityM * (dMy/rm) };

             // Drag (Force)
             let dragVec = { x: 0, y: 0 };
             const alt = r - PLANET_RADIUS;
             if (alt < ATMOSPHERE_HEIGHT) {
                 const density = 1.225 * Math.exp(-alt / 7000);
                 const vSq = vDot(vel, vel);
                 const speed = Math.sqrt(vSq);
                 if (density > 0 && speed > 0.1) {
                     const dragMag = 0.5 * density * vSq * dragArea * 0.2;
                     dragVec = vScale(vNorm(vel), -dragMag);
                 }
             }

             // SOI Logic (Patched Conics)
             let gravity = gVecP;
             if (rm < MOON_SOI_RADIUS) gravity = gVecM;

             return { gravity, drag: dragVec };
        };

        const calculateDerivatives = (state: PhysicsState, t: number): Derivatives => {
            const f = getForces(state.pos, state.vel, t, newMass);
            
            const tDir = { x: Math.sin(state.rot), y: -Math.cos(state.rot) };
            const tVec = vScale(tDir, totalThrustMag);
            
            const totalF = vAdd(vAdd(f.gravity, f.drag), tVec);
            const linAcc = vScale(totalF, 1/newMass);

            // Torque
            let torque = 0;
            if (keysRef.current.left) torque -= 10000;
            if (keysRef.current.right) torque += 10000;
            
            const sas = stateRef.current.sasMode;
            if (sas !== SASMode.MANUAL) {
                let target = targetRotation;
                const spd = vMag(state.vel);
                if (spd > 1) {
                    const prog = Math.atan2(state.vel.y, state.vel.x);
                    if (sas === SASMode.PROGRADE) target = prog + Math.PI/2;
                    if (sas === SASMode.RETROGRADE) target = prog - Math.PI/2;
                }
                if (sas === SASMode.STABILITY) torque -= state.angVel * momentOfInertia * 2;
                else {
                    let err = target - state.rot;
                    while (err > Math.PI) err -= Math.PI*2;
                    while (err < -Math.PI) err += Math.PI*2;
                    torque += (err * 20000 - state.angVel * 20000);
                }
            } else {
                torque -= state.angVel * momentOfInertia * 0.1; 
            }

            return {
                vel: state.vel,
                acc: linAcc,
                angVel: state.angVel,
                angAcc: torque / momentOfInertia
            };
        };

        // RK4 Step
        const k1 = calculateDerivatives({ pos: position, vel: velocity, rot: rotation, angVel: angularVelocity }, currentTime);
        
        const sk2 = {
            pos: vAdd(position, vScale(k1.vel, dt/2)),
            vel: vAdd(velocity, vScale(k1.acc, dt/2)),
            rot: rotation + k1.angVel * dt/2,
            angVel: angularVelocity + k1.angAcc * dt/2
        };
        const k2 = calculateDerivatives(sk2, currentTime + dt/2);

        const sk3 = {
            pos: vAdd(position, vScale(k2.vel, dt/2)),
            vel: vAdd(velocity, vScale(k2.acc, dt/2)),
            rot: rotation + k2.angVel * dt/2,
            angVel: angularVelocity + k2.angAcc * dt/2
        };
        const k3 = calculateDerivatives(sk3, currentTime + dt/2);

        const sk4 = {
            pos: vAdd(position, vScale(k3.vel, dt)),
            vel: vAdd(velocity, vScale(k3.acc, dt)),
            rot: rotation + k3.angVel * dt,
            angVel: angularVelocity + k3.angAcc * dt
        };
        const k4 = calculateDerivatives(sk4, currentTime + dt);

        position = vAdd(position, vScale(vAdd(vAdd(k1.vel, vScale(k2.vel, 2)), vAdd(vScale(k3.vel, 2), k4.vel)), dt/6));
        velocity = vAdd(velocity, vScale(vAdd(vAdd(k1.acc, vScale(k2.acc, 2)), vAdd(vScale(k3.acc, 2), k4.acc)), dt/6));
        rotation = rotation + (k1.angVel + 2*k2.angVel + 2*k3.angVel + k4.angVel) * dt/6;
        angularVelocity = angularVelocity + (k1.angAcc + 2*k2.angAcc + 2*k3.angAcc + k4.angAcc) * dt/6;
        
        // Debug Data from last substep
        if (s === PHYSICS_SUBSTEPS - 1) {
            const f = getForces(position, velocity, currentTime + dt, newMass);
            finalForces = { 
                gravity: f.gravity, 
                drag: f.drag, 
                thrust: vScale({ x: Math.sin(rotation), y: -Math.cos(rotation) }, totalThrustMag) 
            };
            setDebugForces({ thrust: totalThrustMag, drag: vMag(f.drag) });
        }
        
        // Collision Checks
        if (vMag(position) <= PLANET_RADIUS) {
            const rVel = vDot(velocity, vNorm(position));
            if (rVel < -10) {
                 events.push("Crashed into Planet");
                 currentState.active = false;
                 currentState.finished = true;
            } else if (vMag(velocity) < 1) {
                 if (maxAltitude > 50) { events.push("Landed on Planet"); currentState.active = false; currentState.finished = true; }
                 else { position = vScale(vNorm(position), PLANET_RADIUS); velocity = {x:0, y:0}; }
            } else {
                 position = vScale(vNorm(position), PLANET_RADIUS);
                 // Bounce/Slide
                 if (rVel < 0) {
                     const tan = { x: -position.y, y: position.x };
                     const tDir = vNorm(tan);
                     velocity = vScale(tDir, vDot(velocity, tDir));
                 }
            }
        }
        
        // Debris Physics (Simplified Euler)
        debris.forEach(d => {
             // Debris assumed mass is 500kg for simulation stability
             const fD = getForces(d.position, d.velocity, currentTime, 500);
             const acc = vScale(vAdd(fD.gravity, fD.drag), 1/500); 
             d.velocity = vAdd(d.velocity, vScale(acc, dt));
             d.position = vAdd(d.position, vScale(d.velocity, dt));
             d.rotation += d.angularVelocity * dt;
        });
    } // End Substeps

    time += totalDt;

    // Orbital Elements Update
    const mAngle = (time / MOON_ORBITAL_PERIOD) * 2 * Math.PI;
    const mPos = { x: Math.cos(mAngle) * MOON_ORBIT_RADIUS, y: Math.sin(mAngle) * MOON_ORBIT_RADIUS };
    const dMoon = vMag(vSub(position, mPos));
    const inMoon = dMoon < MOON_SOI_RADIUS;

    let mu = GRAVITATIONAL_PARAM;
    let rPos = position;
    let rVel = velocity;
    
    if (inMoon) {
        mu = MOON_GRAVITATIONAL_PARAM;
        const mVelAngle = mAngle + Math.PI/2;
        const mSpeed = 2 * Math.PI * MOON_ORBIT_RADIUS / MOON_ORBITAL_PERIOD;
        const mVel = { x: Math.cos(mVelAngle)*mSpeed, y: Math.sin(mVelAngle)*mSpeed };
        rPos = vSub(position, mPos);
        rVel = vSub(velocity, mVel);
    }

    const r = vMag(rPos);
    const v = vMag(rVel);
    const vSq = v*v;
    const specE = vSq/2 - mu/r;
    const sma = -mu / (2*specE);
    
    // Eccentricity
    const rv = vDot(rPos, rVel);
    const eVec = {
        x: ((vSq - mu/r)*rPos.x - rv*rVel.x)/mu,
        y: ((vSq - mu/r)*rPos.y - rv*rVel.y)/mu
    };
    const ecc = vMag(eVec);
    let apo = 0, peri = 0;
    const bodyR = inMoon ? MOON_RADIUS : PLANET_RADIUS;
    
    if (ecc < 1) {
        peri = sma * (1 - ecc) - bodyR;
        apo = sma * (1 + ecc) - bodyR;
    } else {
        peri = sma * (1 - ecc) - bodyR;
        apo = NaN;
    }

    stateRef.current = {
        ...currentState,
        position, velocity, rotation, angularVelocity, time, 
        maxAltitude: Math.max(maxAltitude, vMag(position) - PLANET_RADIUS),
        altitude: vMag(position) - PLANET_RADIUS,
        velocityMag: vMag(velocity),
        verticalVelocity: vDot(velocity, vNorm(position)),
        horizontalVelocity: 0, // Simplified
        semiMajorAxis: sma, eccentricity: ecc, apoapsis: apo, periapsis: peri, specificEnergy: specE,
        forces: finalForces,
        debris,
        parts,
        events
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
                
                {/* DEBUG FORCES UI */}
                <div className="mt-2 pt-2 border-t border-slate-700 text-xs">
                    <div className="flex items-center text-slate-500 mb-1 font-bold"><Bug size={10} className="mr-1"/> PHYSICS DEBUG</div>
                    <div className="flex justify-between">
                        <span className="text-slate-400">THRUST</span>
                        <span className="font-mono text-orange-400">{(debugForces.thrust/1000).toFixed(1)} kN</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400">DRAG</span>
                        <span className="font-mono text-red-400">{(debugForces.drag/1000).toFixed(1)} kN</span>
                    </div>
                    <div className="flex justify-between mt-1">
                        <span className="text-slate-400">ENERGY</span>
                        <span className="font-mono text-emerald-400">{(simState.specificEnergy/1000).toFixed(2)} MJ/kg</span>
                    </div>
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