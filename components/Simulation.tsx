import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RocketPart, PartType, SimulationState, TelemetryPoint, Vector2, Debris, SASMode } from '../types';
import { Play, Layers, X, Square, Pause, RotateCcw, Move, Anchor, CircleOff, ArrowUpCircle, ArrowDownCircle, Power, Crosshair, Umbrella } from 'lucide-react';
import { AreaChart, Area, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { calculateRocketLayout, SCALE } from '../utils/rocketUtils';
import { drawPartShape, getPartStyle, setupCanvas } from '../utils/renderUtils';

interface SimulationProps {
  initialParts: RocketPart[];
  onExit: () => void;
}

// Planetary Constants (Kerbin-like sized planet for better gameplay scaling)
const PLANET_RADIUS = 600000; // 600km
const SURFACE_GRAVITY = 9.81;
// GM = g * r^2
const GRAVITATIONAL_PARAM = SURFACE_GRAVITY * PLANET_RADIUS * PLANET_RADIUS; 
const ATMOSPHERE_HEIGHT = 70000; // 70km

const TIME_STEP = 0.05; 
const ROTATION_SPEED = 2.0; 
const THROTTLE_SPEED = 0.5; // Full throttle in 2 seconds

// SAS Constants
const SAS_KP = 8.0; // Proportional Gain (Turn strength)
const SAS_KD = 6.0; // Derivative Gain (Damping)

const NavBall: React.FC<{ rotation: number, position: Vector2, velocity: Vector2, sasMode: SASMode }> = ({ rotation, position, velocity, sasMode }) => {
    // Math Setup
    // 1. Planet Up Vector Angle (Radial Out)
    const planetAngle = Math.atan2(position.y, position.x);
    
    // We want the Background (Sky/Ground) to rotate relative to the Rocket.
    // If Rot increases (tilts right), Background should tilt Left (-).
    // Angle = (Rad + PI/2) - Rot.
    const rad2deg = 180 / Math.PI;
    const bgRotation = ((planetAngle + Math.PI/2) - rotation) * rad2deg;
    
    // Prograde Marker Rotation (relative to Visual Up)
    // If Vel aligns with Rocket, rotation should be 0.
    const velocityAngle = Math.atan2(velocity.y, velocity.x);
    const progradeRotation = (velocityAngle - (rotation - Math.PI/2)) * rad2deg;
    const retrogradeRotation = progradeRotation + 180;
    
    // SAS Target Markers
    let sasTargetRot: number | null = null;
    let sasIcon = null;
    
    if (sasMode === SASMode.PROGRADE) {
        sasTargetRot = progradeRotation;
        sasIcon = <ArrowUpCircle size={12} className="text-green-400" strokeWidth={3}/>;
    } else if (sasMode === SASMode.RETROGRADE) {
        sasTargetRot = retrogradeRotation;
        sasIcon = <ArrowDownCircle size={12} className="text-orange-400" strokeWidth={3}/>;
    } else if (sasMode === SASMode.STABILITY) {
        // Stability holds current, so marker is center
        sasTargetRot = 0; 
        sasIcon = <CircleOff size={12} className="text-cyan-400" strokeWidth={3}/>;
    }

    // Determine if prograde is visible (speed > 1m/s)
    const showPrograde = (velocity.x**2 + velocity.y**2) > 1;

    return (
        <div className="relative w-32 h-32 rounded-full border-4 border-slate-600 bg-slate-800 overflow-hidden shadow-2xl">
            {/* Rotating Background (Gyro) */}
            <div 
                className="absolute inset-[-50%] w-[200%] h-[200%] origin-center"
                style={{ 
                    background: 'linear-gradient(to bottom, #3b82f6 50%, #854d0e 50%)',
                    transform: `rotate(${bgRotation}deg)`
                }}
            >
                {/* Horizon Line */}
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-white/50 -mt-[1px]"></div>
            </div>

            {/* Crosshair (Fixed Rocket Reference) */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-80">
                <div className="w-8 h-1 bg-orange-500 rounded-full absolute"></div>
                <div className="w-1 h-4 bg-orange-500 rounded-full absolute -mt-2"></div>
            </div>

            {/* Markers Container - Rotated relative to rocket */}
            
            {showPrograde && (
                <>
                    {/* Prograde */}
                    <div 
                        className="absolute top-1/2 left-1/2 w-0 h-0 flex items-center justify-center"
                        style={{ transform: `rotate(${progradeRotation}deg) translateY(-54px)` }}
                    >
                         <div className="w-4 h-4 rounded-full border-2 border-green-400 flex items-center justify-center">
                             <div className="w-1 h-1 bg-green-400 rounded-full"></div>
                             <div className="absolute -top-2 w-[2px] h-2 bg-green-400"></div>
                             <div className="absolute -left-2 w-2 h-[2px] bg-green-400"></div>
                             <div className="absolute -right-2 w-2 h-[2px] bg-green-400"></div>
                         </div>
                    </div>
                    {/* Retrograde */}
                     <div 
                        className="absolute top-1/2 left-1/2 w-0 h-0 flex items-center justify-center"
                        style={{ transform: `rotate(${retrogradeRotation}deg) translateY(-54px)` }}
                    >
                         <div className="w-4 h-4 rounded-full border-2 border-red-500 flex items-center justify-center relative">
                             <div className="w-3 h-[2px] bg-red-500 transform rotate-45"></div>
                             <div className="w-3 h-[2px] bg-red-500 transform -rotate-45"></div>
                         </div>
                    </div>
                </>
            )}

            {/* SAS Target Ghost Marker */}
            {sasTargetRot !== null && (
                 <div 
                    className="absolute top-1/2 left-1/2 w-0 h-0 flex items-center justify-center opacity-70"
                    style={{ transform: `rotate(${sasTargetRot}deg) translateY(-40px)` }}
                >
                    {sasIcon}
                </div>
            )}
            
            {/* Glass Glare */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent to-white/10 pointer-events-none"></div>
        </div>
    );
};

export const Simulation: React.FC<SimulationProps> = ({ initialParts, onExit }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.5); // Start zoomed out a bit to see context
  const zoomRef = useRef(0.5); 
  const [showForces, setShowForces] = useState(false);
  
  const [activeParts, setActiveParts] = useState<RocketPart[]>(() => JSON.parse(JSON.stringify(initialParts)));
  
  const keysRef = useRef({ left: false, right: false, shift: false, ctrl: false });
  
  // Initialize on the "North Pole" of the planet (0, -Radius)
  const [simState, setSimState] = useState<SimulationState>({
    position: { x: 0, y: -PLANET_RADIUS - 2 }, // Start 2m above surface
    velocity: { x: 0, y: 0 },
    rotation: 0, 
    angularVelocity: 0,
    throttle: 1.0,
    sasMode: SASMode.STABILITY,
    altitude: 0,
    velocityMag: 0,
    verticalVelocity: 0,
    horizontalVelocity: 0,
    acceleration: 0,
    semiMajorAxis: 0,
    eccentricity: 0,
    apoapsis: 0,
    periapsis: 0,
    time: 0,
    parts: activeParts,
    debris: [],
    active: false,
    finished: false,
    maxAltitude: 0,
    events: [],
    forces: {
        thrust: { x: 0, y: 0 },
        gravity: { x: 0, y: 0 },
        drag: { x: 0, y: 0 }
    }
  });
  
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const requestRef = useRef<number>(0);
  const stateRef = useRef(simState);
  const showForcesRef = useRef(showForces);

  useEffect(() => {
      showForcesRef.current = showForces;
  }, [showForces]);
  
  useEffect(() => {
    stateRef.current = {
        ...stateRef.current,
        active: simState.active,
        finished: simState.finished,
        parts: activeParts,
        sasMode: simState.sasMode // Sync SAS mode on external change
    };
  }, [simState.active, simState.finished, activeParts, simState.sasMode]);

  const deployParachutes = useCallback(() => {
      const updatedParts = stateRef.current.parts.map(p => {
          if (p.type === PartType.PARACHUTE) {
              return { ...p, isDeployed: true };
          }
          return p;
      });
      setActiveParts(updatedParts);
      // Update event log
      const newEvents = [...stateRef.current.events, `T+${stateRef.current.time.toFixed(1)}s: Parachutes Deployed`];
      stateRef.current = { ...stateRef.current, parts: updatedParts, events: newEvents };
      setSimState(stateRef.current);
  }, []);

  // Input Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') keysRef.current.left = true;
      if (e.key === 'ArrowRight') keysRef.current.right = true;
      if (e.key === 'Shift') keysRef.current.shift = true;
      if (e.key === 'Control') keysRef.current.ctrl = true;
      
      if (e.key.toLowerCase() === 'z') {
           stateRef.current.throttle = 1.0;
           setSimState(prev => ({ ...prev, throttle: 1.0 }));
      }
      if (e.key.toLowerCase() === 'x') {
           stateRef.current.throttle = 0.0;
           setSimState(prev => ({ ...prev, throttle: 0.0 }));
      }
      if (e.key.toLowerCase() === 'p') {
          deployParachutes();
      }
      // SAS Shortcuts
      if (e.key.toLowerCase() === 't') {
          // Toggle stability
          const newMode = stateRef.current.sasMode === SASMode.STABILITY ? SASMode.MANUAL : SASMode.STABILITY;
          stateRef.current.sasMode = newMode;
          setSimState(prev => ({ ...prev, sasMode: newMode }));
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') keysRef.current.left = false;
      if (e.key === 'ArrowRight') keysRef.current.right = false;
      if (e.key === 'Shift') keysRef.current.shift = false;
      if (e.key === 'Control') keysRef.current.ctrl = false;
    };
    const handleWheel = (e: WheelEvent) => {
        // Updated zoom limit to allow seeing whole planet
        const newZoom = Math.max(0.000002, Math.min(zoomRef.current - e.deltaY * 0.001 * zoomRef.current, 50));
        zoomRef.current = newZoom;
        setZoom(newZoom);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWheel);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [deployParachutes]);

  const updatePhysics = useCallback(() => {
    const currentState = stateRef.current;
    if (currentState.finished) return; 
    if (!currentState.active) return;

    let { position, velocity, rotation, angularVelocity, time, maxAltitude, events, debris, parts, throttle, sasMode } = currentState;
    
    // Throttle Input
    if (keysRef.current.shift) {
        throttle = Math.min(1.0, throttle + THROTTLE_SPEED * TIME_STEP);
    }
    if (keysRef.current.ctrl) {
        throttle = Math.max(0.0, throttle - THROTTLE_SPEED * TIME_STEP);
    }

    // 1. Calculate Mass & Thrust
    let mass = 0;
    let dragArea = 0;
    let finArea = 0;
    parts.forEach(p => {
        const fuel = p.currentFuel || 0;
        mass += p.mass + fuel;
        
        // Drag Calculation
        if (p.type === PartType.PARACHUTE && p.isDeployed) {
            dragArea += 500; // Massive drag for chutes
        } else {
            dragArea += p.width * p.width; 
        }
        
        if (p.type === PartType.FIN) finArea += 1.0; 
    });

    let totalThrust = 0;
    // Reset thrust flags
    parts.forEach(p => p.isThrusting = false);
    
    const engines = parts.filter(p => p.type === PartType.ENGINE);
    let anyEngineHasFuel = false;

    // BFS Fuel Logic
    engines.forEach(eng => {
        const obstructed = parts.some(p => p.parentId === eng.instanceId && p.parentNodeId === 'bottom');
        if (obstructed) return;

        const sourceTanks: RocketPart[] = [];
        const visited = new Set<string>();
        const queue = [eng];
        visited.add(eng.instanceId);

        if ((eng.currentFuel || 0) > 0) sourceTanks.push(eng);

        while (queue.length > 0) {
            const curr = queue.shift()!;
            const neighbors: RocketPart[] = [];
            if (curr.parentId) {
                const parent = parts.find(p => p.instanceId === curr.parentId);
                if (parent) neighbors.push(parent);
            }
            const children = parts.filter(p => p.parentId === curr.instanceId);
            neighbors.push(...children);
            
            for (const neighbor of neighbors) {
                if (visited.has(neighbor.instanceId)) continue;
                if (neighbor.type === PartType.DECOUPLER) {
                    visited.add(neighbor.instanceId);
                    continue;
                }
                visited.add(neighbor.instanceId);
                if (neighbor.type === PartType.TANK && (neighbor.currentFuel || 0) > 0) {
                    sourceTanks.push(neighbor);
                }
                queue.push(neighbor);
            }
        }

        const availableInStage = sourceTanks.reduce((sum, t) => sum + (t.currentFuel || 0), 0);
        
        if (availableInStage > 0.001) {
            anyEngineHasFuel = true;
            if (throttle > 0) {
                const idealFuelNeeded = (eng.burnRate || 0) * throttle * TIME_STEP;
                let actualFuelConsumed = idealFuelNeeded;
                let thrustRatio = 1.0;
                
                if (idealFuelNeeded > availableInStage) {
                    actualFuelConsumed = availableInStage;
                    thrustRatio = availableInStage / idealFuelNeeded;
                }

                eng.isThrusting = true;
                totalThrust += (eng.thrust || 0) * throttle * thrustRatio;
                
                if (actualFuelConsumed > 0) {
                    let remainingToDrain = actualFuelConsumed;
                    let attempts = 0;
                    while (remainingToDrain > 0.000001 && attempts < 3) {
                        const activeTanks = sourceTanks.filter(t => (t.currentFuel || 0) > 0);
                        if (activeTanks.length === 0) break;
                        const drainPerTank = remainingToDrain / activeTanks.length;
                        activeTanks.forEach(t => {
                            const current = t.currentFuel || 0;
                            const drain = Math.min(current, drainPerTank);
                            t.currentFuel = current - drain;
                            remainingToDrain -= drain;
                        });
                        attempts++;
                    }
                }
            }
        } else {
             eng.isThrusting = false;
        }
    });

    if (!anyEngineHasFuel && engines.length > 0 && totalThrust === 0 && throttle > 0) {
        if (!events.some(e => e.includes('Burnout'))) events = [...events, `T+${time.toFixed(1)}s: Burnout`];
    }

    // 2. Orbital Physics
    const distSq = position.x*position.x + position.y*position.y;
    const dist = Math.sqrt(distSq);
    const altitude = dist - PLANET_RADIUS;
    
    const gravAccelMag = GRAVITATIONAL_PARAM / distSq;
    const gravAccelX = -position.x / dist * gravAccelMag;
    const gravAccelY = -position.y / dist * gravAccelMag;

    const rho = altitude < ATMOSPHERE_HEIGHT 
        ? 1.225 * Math.exp(-altitude / 7000) 
        : 0;

    const speedSq = velocity.x*velocity.x + velocity.y*velocity.y;
    const speed = Math.sqrt(speedSq);

    const rVector = { x: position.x, y: position.y };
    const vVector = { x: velocity.x, y: velocity.y };
    
    const specificEnergy = (speedSq)/2 - GRAVITATIONAL_PARAM/dist;
    const semiMajorAxis = -GRAVITATIONAL_PARAM / (2 * specificEnergy);
    const h = rVector.x * vVector.y - rVector.y * vVector.x;
    const eccentricity = Math.sqrt(Math.max(0, 1 + (2 * specificEnergy * h * h) / (GRAVITATIONAL_PARAM * GRAVITATIONAL_PARAM)));
    
    let periapsis = 0;
    let apoapsis = 0;
    if (eccentricity < 1) {
        periapsis = semiMajorAxis * (1 - eccentricity) - PLANET_RADIUS;
        apoapsis = semiMajorAxis * (1 + eccentricity) - PLANET_RADIUS;
    } else {
        periapsis = semiMajorAxis * (1 - eccentricity) - PLANET_RADIUS;
        apoapsis = Infinity;
    }

    const vVert = (velocity.x * position.x + velocity.y * position.y) / dist;
    const vHoriz = Math.abs((velocity.x * -position.y + velocity.y * position.x) / dist);

    let dragFx = 0;
    let dragFy = 0;
    if (rho > 0 && speed > 0) {
        const dragForce = 0.5 * rho * speedSq * (dragArea * 0.05);
        const dragAx = -velocity.x / speed;
        const dragAy = -velocity.y / speed;
        dragFx = dragAx * dragForce;
        dragFy = dragAy * dragForce;
    }

    const thrustX = Math.sin(rotation) * totalThrust;
    const thrustY = -Math.cos(rotation) * totalThrust;

    let torque = 0;
    if (rho > 0 && finArea > 0 && speed > 10) {
        const velAngle = Math.atan2(velocity.y, velocity.x);
        const mathRotation = rotation - Math.PI / 2;
        let aoa = velAngle - mathRotation;
        while (aoa > Math.PI) aoa -= Math.PI*2;
        while (aoa < -Math.PI) aoa += Math.PI*2;
        
        torque = aoa * speed * finArea * 500; 
        torque -= angularVelocity * speed * finArea * 50;
    }
    
    // --- Attitude Control System (SAS) ---
    const MOI = Math.max(mass * 20, 100); 
    const isManualInput = keysRef.current.left || keysRef.current.right;

    if (isManualInput) {
        // Manual Override
        if (keysRef.current.left) torque -= ROTATION_SPEED * MOI;
        if (keysRef.current.right) torque += ROTATION_SPEED * MOI;
    } else if (sasMode !== SASMode.MANUAL) {
        // SAS Logic
        let targetRotation: number | null = null;
        
        // Only calculate Prograde/Retrograde if moving fast enough to have a stable vector
        if (speed > 1.0) {
            const velocityAngle = Math.atan2(velocity.y, velocity.x);
            // Visual UP is 0 rotation, which corresponds to Vector(0, -1). 
            // In standard math, (0, -1) is -PI/2.
            // So Rotation 0 = Math Angle -PI/2.
            // Therefore Math Angle = Rotation - PI/2.
            // Or Rotation = Math Angle + PI/2.
            
            if (sasMode === SASMode.PROGRADE) {
                targetRotation = velocityAngle + Math.PI / 2;
            } else if (sasMode === SASMode.RETROGRADE) {
                targetRotation = velocityAngle + Math.PI / 2 + Math.PI;
            }
        } 
        
        // If mode is Prograde/Retrograde but speed is low, targetRotation is null.
        // In this case, we default to Stability logic (holding attitude/killing rotation).

        if (targetRotation === null) {
            // Kill Rotation: PID Target Rate = 0
            // Torque = (TargetRate - CurrentRate) * KD
            torque -= angularVelocity * SAS_KD * MOI; 
        } else {
            // Aim at Target: PID Controller
            let error = targetRotation - rotation;
            // Normalize error to -PI to PI
            while (error > Math.PI) error -= Math.PI * 2;
            while (error < -Math.PI) error += Math.PI * 2;

            // PD Controller
            // Output = Kp * error - Kd * velocity
            const controlSignal = (error * SAS_KP - angularVelocity * SAS_KD);
            
            // Clamp torque so we don't spin wildly physically
            torque += controlSignal * MOI; 
        }
    }
    // If MANUAL mode and no input, torque remains 0 (or whatever aero torque was calculated)

    const angularAccel = torque / MOI;
    angularVelocity += angularAccel * TIME_STEP;
    rotation += angularVelocity * TIME_STEP;
    
    const ax = (thrustX + dragFx) / mass + gravAccelX;
    const ay = (thrustY + dragFy) / mass + gravAccelY;

    velocity.x += ax * TIME_STEP;
    velocity.y += ay * TIME_STEP;
    position.x += velocity.x * TIME_STEP;
    position.y += velocity.y * TIME_STEP;

    // Collision Detection
    let active: boolean = currentState.active;
    let finished: boolean = currentState.finished;

    if (dist < PLANET_RADIUS) {
        position.x = (position.x / dist) * PLANET_RADIUS;
        position.y = (position.y / dist) * PLANET_RADIUS;
        
        if (speed > 10) {
             events = [...events, `T+${time.toFixed(1)}s: Impact at ${speed.toFixed(0)} m/s`];
             active = false;
             finished = true;
             velocity = {x:0, y:0};
        } else {
             if (speed > 0.1 && !events.some(e => e.includes('Touchdown'))) events = [...events, `T+${time.toFixed(1)}s: Touchdown`];
             velocity = {x:0, y:0};
             angularVelocity = 0;
        }
    }

    // Debris Physics
    const newDebris = debris.map(d => {
        const dDistSq = d.position.x*d.position.x + d.position.y*d.position.y;
        const dDist = Math.sqrt(dDistSq);
        const dGAX = -d.position.x / dDist * (GRAVITATIONAL_PARAM / dDistSq);
        const dGAY = -d.position.y / dDist * (GRAVITATIONAL_PARAM / dDistSq);
        
        let dvx = d.velocity.x + dGAX * TIME_STEP;
        let dvy = d.velocity.y + dGAY * TIME_STEP;
        let dpx = d.position.x + dvx * TIME_STEP;
        let dpy = d.position.y + dvy * TIME_STEP;
        
        if (dDist - PLANET_RADIUS < ATMOSPHERE_HEIGHT) {
            dvx *= 0.99;
            dvy *= 0.99;
        }

        return {
            ...d,
            position: { x: dpx, y: dpy },
            velocity: { x: dvx, y: dvy },
            rotation: d.rotation + d.angularVelocity * TIME_STEP
        };
    }).filter(d => {
        const h = Math.sqrt(d.position.x**2 + d.position.y**2) - PLANET_RADIUS;
        return h > 0; 
    });

    const nextState = {
        ...currentState,
        position, velocity, rotation, angularVelocity,
        altitude,
        throttle,
        velocityMag: speed,
        verticalVelocity: vVert,
        horizontalVelocity: vHoriz,
        acceleration: Math.sqrt(ax*ax + ay*ay),
        semiMajorAxis,
        eccentricity,
        apoapsis,
        periapsis,
        time: time + TIME_STEP,
        maxAltitude: Math.max(maxAltitude, altitude),
        events, debris: newDebris, active, finished,
        forces: {
            thrust: { x: thrustX, y: thrustY },
            drag: { x: dragFx, y: dragFy },
            gravity: { x: gravAccelX * mass, y: gravAccelY * mass }
        }
    };
    stateRef.current = nextState;
    setSimState(nextState);
    
    if (Math.floor(time * 20) % 10 === 0) {
        setTelemetry(prev => [...prev.slice(-49), {
            time: Number(time.toFixed(1)),
            altitude: Number(altitude.toFixed(1)),
            velocity: Number(speed.toFixed(1)),
            verticalVelocity: Number(vVert.toFixed(1)),
            horizontalVelocity: Number(vHoriz.toFixed(1))
        }]);
    }
  }, []); 

  const animate = useCallback(() => {
    updatePhysics();
    drawFrame();
    requestRef.current = requestAnimationFrame(animate);
  }, [updatePhysics]);

  const drawVector = (ctx: CanvasRenderingContext2D, vx: number, vy: number, color: string, label: string) => {
      const mag = Math.sqrt(vx*vx + vy*vy);
      if (mag < 100) return; // Hide negligible forces
      
      const SCALE_FORCE = 0.0005; // 200kN = 100px
      const dx = vx * SCALE_FORCE;
      const dy = vy * SCALE_FORCE;
      
      // We are at Rocket Center.
      
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(dx, dy);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 / zoomRef.current; // Constant thickness
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(dy, dx);
      const headLen = 15 / zoomRef.current;
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(dx - headLen * Math.cos(angle - Math.PI / 6), dy - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(dx - headLen * Math.cos(angle + Math.PI / 6), dy - headLen * Math.sin(angle + Math.PI / 6));
      ctx.fillStyle = color;
      ctx.fill();
  };

  const drawOrbit = (ctx: CanvasRenderingContext2D, pos: Vector2, vel: Vector2) => {
      // Calculate Orbital Elements on the fly for rendering
      const x = pos.x;
      const y = pos.y;
      const vx = vel.x;
      const vy = vel.y;
      
      const r = Math.sqrt(x*x + y*y);
      const vSq = vx*vx + vy*vy;
      const mu = GRAVITATIONAL_PARAM;
      
      // Angular momentum h = r x v (2D cross product)
      const h = x*vy - y*vx;
      
      // Eccentricity Vector e = (1/mu) * [(v^2 - mu/r)r - (r.v)v]
      const rDotV = x*vx + y*vy;
      const term1 = vSq - mu/r;
      const ex = (1/mu) * (term1*x - rDotV*vx);
      const ey = (1/mu) * (term1*y - rDotV*vy);
      
      const ecc = Math.sqrt(ex*ex + ey*ey);
      const argPeriapsis = Math.atan2(ey, ex); // angle of periapsis vector
      
      // Semi-latus rectum p = h^2 / mu
      const p = (h*h) / mu;
      
      ctx.save();
      // Orbit drawing is in World Space (Planet Center 0,0)
      // Existing context is already set to World Space by drawFrame before calling this, if we insert it correctly.
      
      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8'; // Sky blue
      ctx.lineWidth = 1 / zoomRef.current;
      if (ctx.lineWidth < 1) ctx.lineWidth = 1;
      ctx.setLineDash([10 / zoomRef.current, 10 / zoomRef.current]);

      // Draw Orbit
      const step = 0.05;
      let started = false;
      
      // Range for theta:
      // Ellipse: 0 to 2PI
      // Hyperbola (e > 1): -acos(-1/e) to acos(-1/e) (asymptotes). 
      // We clip slightly to avoid infinity.
      
      let startTheta = 0;
      let endTheta = Math.PI * 2;
      
      if (ecc > 1.0) {
          const asymptoteAngle = Math.acos(-1/ecc);
          startTheta = -asymptoteAngle + 0.1;
          endTheta = asymptoteAngle - 0.1;
      }
      
      for (let theta = startTheta; theta <= endTheta; theta += step) {
          const r_theta = p / (1 + ecc * Math.cos(theta));
          
          // Polar to Cartesian in Orbit Frame (Periapsis on X axis)
          const ox = r_theta * Math.cos(theta);
          const oy = r_theta * Math.sin(theta);
          
          // Rotate to World Frame
          const wx = ox * Math.cos(argPeriapsis) - oy * Math.sin(argPeriapsis);
          const wy = ox * Math.sin(argPeriapsis) + oy * Math.cos(argPeriapsis);
          
          if (!started) {
              ctx.moveTo(wx * SCALE, wy * SCALE);
              started = true;
          } else {
              ctx.lineTo(wx * SCALE, wy * SCALE);
          }
      }
      if (ecc < 1.0) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Draw Markers (Ap/Pe)
      const drawMarker = (label: string, theta: number) => {
          const r_m = p / (1 + ecc * Math.cos(theta));
          const ox = r_m * Math.cos(theta);
          const oy = r_m * Math.sin(theta);
          const wx = ox * Math.cos(argPeriapsis) - oy * Math.sin(argPeriapsis);
          const wy = ox * Math.sin(argPeriapsis) + oy * Math.cos(argPeriapsis);
          
          // Don't draw Apoapsis if hyperbolic and negative distance (math artifact, though handled by theta limits usually)
          if (r_m < 0) return;

          const screenX = wx * SCALE;
          const screenY = wy * SCALE;
          
          ctx.save();
          ctx.translate(screenX, screenY);
          // Scale marker to stay constant size on screen
          const scale = 1/zoomRef.current;
          ctx.scale(scale, scale);
          
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(0, 0, 4, 0, Math.PI*2);
          ctx.fill();
          
          ctx.fillStyle = 'white';
          ctx.font = '12px monospace';
          ctx.fillText(label, 8, 4);
          ctx.restore();
      };
      
      drawMarker("Pe", 0);
      if (ecc < 1.0) drawMarker("Ap", Math.PI);

      ctx.restore();
  };

  const drawFrame = () => {
     if (!canvasRef.current || !containerRef.current) return;
     const { clientWidth, clientHeight } = containerRef.current;
     if (canvasRef.current.width !== clientWidth * (window.devicePixelRatio||1)) {
         setupCanvas(canvasRef.current, clientWidth, clientHeight);
     }
     const ctx = canvasRef.current.getContext('2d');
     if (!ctx) return;
     
     const dpr = window.devicePixelRatio || 1;
     ctx.resetTransform();
     ctx.scale(dpr, dpr);
     ctx.clearRect(0,0, clientWidth, clientHeight);
     
     const { position, rotation, velocity, debris, parts, altitude, forces, throttle } = stateRef.current;
     const currentZoom = zoomRef.current;

     const cx = clientWidth / 2;
     const cy = clientHeight / 2;

     // Camera Transform
     const planetAngle = Math.atan2(position.y, position.x);
     const viewRotation = -Math.PI / 2 - planetAngle;

     ctx.save();
     
     // 3a. Move to Center of Screen
     ctx.translate(cx, cy);
     
     // 3b. Rotate World
     ctx.rotate(viewRotation);
     
     // 3c. Scale
     ctx.scale(currentZoom, currentZoom);
     
     // 3d. Translate World so Rocket is at (0,0) (before screen centering)
     ctx.translate(-position.x * SCALE, -position.y * SCALE);
     
     // --- DRAW WORLD SPACE ---

     // Draw Planet
     ctx.beginPath();
     ctx.arc(0, 0, PLANET_RADIUS * SCALE, 0, Math.PI * 2);
     ctx.fillStyle = '#3b82f6'; // Ocean Blue
     ctx.fill();
     
     // Atmosphere
     const grad = ctx.createRadialGradient(0, 0, PLANET_RADIUS * SCALE, 0, 0, (PLANET_RADIUS + ATMOSPHERE_HEIGHT) * SCALE);
     grad.addColorStop(0, 'rgba(147, 197, 253, 0.5)'); 
     grad.addColorStop(1, 'rgba(147, 197, 253, 0)');
     ctx.fillStyle = grad;
     ctx.beginPath();
     ctx.arc(0, 0, (PLANET_RADIUS + ATMOSPHERE_HEIGHT) * SCALE, 0, Math.PI*2);
     ctx.fill();

     // Draw Orbit
     if (altitude > 1000 || (velocity.x*velocity.x + velocity.y*velocity.y) > 100) {
         drawOrbit(ctx, position, velocity);
     }

     // Draw Debris
     debris.forEach(d => {
         ctx.save();
         ctx.translate(d.position.x * SCALE, d.position.y * SCALE);
         ctx.rotate(d.rotation);
         const layout = calculateRocketLayout(d.parts);
         layout.forEach(p => renderPart(ctx, p, 1));
         ctx.restore();
     });

     // Draw Active Rocket
     ctx.save();
     ctx.translate(position.x * SCALE, position.y * SCALE);
     ctx.rotate(rotation);
     const rocketLayout = calculateRocketLayout(parts);
     rocketLayout.forEach(p => renderPart(ctx, p, throttle));
     ctx.restore();

     // Draw Force Vectors (Overlaid on Rocket Center)
     if (showForcesRef.current && forces) {
         ctx.save();
         ctx.translate(position.x * SCALE, position.y * SCALE);
         // Don't rotate - forces are in World Space (aligned with XY axes)
         
         drawVector(ctx, forces.thrust.x, forces.thrust.y, '#fbbf24', 'Thrust'); // Yellow
         drawVector(ctx, forces.drag.x, forces.drag.y, '#ef4444', 'Drag');       // Red
         drawVector(ctx, forces.gravity.x, forces.gravity.y, '#a855f7', 'Grav'); // Purple
         
         ctx.restore();
     }
     
     ctx.restore();
  };

  const renderPart = (ctx: CanvasRenderingContext2D, p: any, throttleLevel: number) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      if (p.radialOffset === -1) ctx.scale(-1, 1);
      
      const w = p.width * SCALE;
      const h = p.height * SCALE;
      const style = getPartStyle(p.type);
      
      ctx.fillStyle = style.fill;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 2; 
      
      drawPartShape(ctx, p.type, w, h, p.isDeployed);
      ctx.fill();
      
      if (p.type === PartType.TANK && p.currentFuel !== undefined && p.fuelCapacity) {
          const ratio = p.currentFuel / p.fuelCapacity;
          if (ratio > 0) {
              ctx.fillStyle = 'rgba(6, 182, 212, 0.5)';
              const fillH = h * ratio;
              const hw = w/2;
              const hh = h/2;
              ctx.fillRect(-hw + 1, hh - fillH, w - 2, fillH);
          }
      }
      ctx.stroke();

      if (p.type === PartType.ENGINE && p.isThrusting && throttleLevel > 0) {
           const hh = h/2;
           ctx.beginPath();
           ctx.moveTo(-w/4, hh);
           ctx.lineTo(w/4, hh);
           // Flame length depends on throttle
           const flameLen = (20 + Math.random()*30) * throttleLevel;
           ctx.lineTo(0, hh + flameLen);
           ctx.fillStyle = `rgba(249, 115, 22, ${0.5 + throttleLevel * 0.5})`; // vary opacity too
           ctx.fill();
      }
      ctx.restore();
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [animate]);

  const handleStage = () => {
    const currentParts = stateRef.current.parts;
    const layout = calculateRocketLayout(currentParts);
    const decouplers = currentParts.filter(p => p.type === PartType.DECOUPLER);
    if (decouplers.length === 0) return;
    
    const sorted = decouplers
        .map(d => ({ part: d, y: layout.find(l => l.instanceId === d.instanceId)?.y || 0 }))
        .sort((a,b) => b.y - a.y);
        
    const target = sorted[0].part;
    const partsToRemove = new Set<string>();
    partsToRemove.add(target.instanceId);
    
    const stack = [target.instanceId];
    while (stack.length > 0) {
        const id = stack.pop()!;
        const children = currentParts.filter(p => p.parentId === id);
        children.forEach(c => {
            partsToRemove.add(c.instanceId);
            stack.push(c.instanceId);
        });
    }
    
    const remaining = currentParts.filter(p => !partsToRemove.has(p.instanceId));
    const staged = currentParts.filter(p => partsToRemove.has(p.instanceId));
    
    const stagedRoot = staged.find(p => p.instanceId === target.instanceId);
    if (stagedRoot) {
        stagedRoot.parentId = undefined;
        stagedRoot.parentNodeId = undefined;
    }

    setActiveParts(remaining);
    
    const { velocity, rotation, position, events, debris, angularVelocity } = stateRef.current;
    
    const kickSpeed = 2;
    const kickX = -Math.sin(rotation) * kickSpeed;
    const kickY = Math.cos(rotation) * kickSpeed; 
    
    const newDebris: Debris = {
        id: Math.random().toString(),
        parts: staged,
        position: { ...position },
        velocity: { x: velocity.x + kickX, y: velocity.y + kickY }, 
        rotation: rotation,
        angularVelocity: angularVelocity + (Math.random()-0.5)
    };
    
    const nextEvents = [...events, `Staging`];
    stateRef.current = { ...stateRef.current, parts: remaining, debris: [...debris, newDebris], events: nextEvents };
    setSimState(stateRef.current);
  };

  const toggleSim = () => setSimState(s => ({ ...s, active: !s.active }));
  const resetSim = () => {
     const initialPos = { x: 0, y: -PLANET_RADIUS - 2 }; 
     const initialRot = 0; 
     
     const resetParts = JSON.parse(JSON.stringify(initialParts));
     setActiveParts(resetParts);
     const resetState: SimulationState = { 
         position: initialPos, 
         velocity: {x:0, y:0}, 
         rotation: initialRot, 
         angularVelocity: 0, 
         altitude: 0,
         velocityMag: 0, 
         verticalVelocity: 0,
         horizontalVelocity: 0,
         acceleration: 0, 
         semiMajorAxis: 0,
         eccentricity: 0,
         apoapsis: 0,
         periapsis: 0,
         time: 0, 
         parts: resetParts, 
         debris: [], 
         active: false, 
         finished: false, 
         maxAltitude: 0, 
         events: [],
         throttle: 1.0,
         sasMode: SASMode.STABILITY,
         forces: {
            thrust: { x: 0, y: 0 },
            gravity: { x: 0, y: 0 },
            drag: { x: 0, y: 0 }
         }
     };
     setSimState(resetState);
     stateRef.current = resetState;
     setTelemetry([]);
  };

  useEffect(() => {
     resetSim();
  }, []);

  const setSAS = (mode: SASMode) => {
      stateRef.current.sasMode = mode;
      setSimState(prev => ({ ...prev, sasMode: mode }));
  };

  const hasParachutes = activeParts.some(p => p.type === PartType.PARACHUTE);

  return (
    <div className="flex h-screen bg-black text-white relative">
      <div className="flex-1 relative overflow-hidden" ref={containerRef}>
        <canvas ref={canvasRef} className="block w-full h-full"/>
        
        {/* HUD */}
        <div className="absolute top-4 left-4 space-y-2 pointer-events-none select-none">
           <div className="flex space-x-2">
                <div className="bg-black/40 backdrop-blur p-3 rounded border border-white/10 w-40">
                    <div className="text-xs text-slate-400 uppercase">Altitude</div>
                    <div className="text-2xl font-mono text-cyan-400">{(simState.altitude/1000).toFixed(1)} km</div>
                </div>
                <div className="bg-black/40 backdrop-blur p-3 rounded border border-white/10 w-40">
                    <div className="text-xs text-slate-400 uppercase">Velocity</div>
                    <div className="text-2xl font-mono text-cyan-400">{simState.velocityMag.toFixed(0)} m/s</div>
                </div>
           </div>
           
           <div className="flex space-x-2">
               <div className="bg-black/40 backdrop-blur p-3 rounded border border-white/10 w-40">
                   <div className="text-xs text-slate-400 uppercase">Vert. Speed</div>
                   <div className="text-xl font-mono text-white">{simState.verticalVelocity.toFixed(0)} m/s</div>
               </div>
               <div className="bg-black/40 backdrop-blur p-3 rounded border border-white/10 w-40">
                   <div className="text-xs text-slate-400 uppercase">Horiz. Speed</div>
                   <div className="text-xl font-mono text-white">{simState.horizontalVelocity.toFixed(0)} m/s</div>
               </div>
           </div>

           <div className="flex space-x-2">
               <div className="bg-black/40 backdrop-blur p-3 rounded border border-white/10 w-40">
                   <div className="text-xs text-slate-400 uppercase">Apoapsis</div>
                   <div className="text-xl font-mono text-purple-400">{(simState.apoapsis > 1e10 ? '∞' : (simState.apoapsis/1000).toFixed(1))} km</div>
               </div>
               <div className="bg-black/40 backdrop-blur p-3 rounded border border-white/10 w-40">
                   <div className="text-xs text-slate-400 uppercase">Periapsis</div>
                   <div className="text-xl font-mono text-purple-400">{(simState.periapsis/1000).toFixed(1)} km</div>
               </div>
           </div>
           
           <div className="bg-black/40 backdrop-blur p-3 rounded border border-white/10 w-40">
               <div className="text-xs text-slate-400 uppercase">Eccentricity</div>
               <div className="text-xl font-mono text-white">{simState.eccentricity.toFixed(3)}</div>
           </div>

           <div className="flex space-x-2">
             <div className="bg-black/40 backdrop-blur p-3 rounded border border-white/10 w-40">
                 <div className="text-xs text-slate-400 uppercase">Mission Time</div>
                 <div className="text-xl font-mono text-white">T+{simState.time.toFixed(1)}s</div>
             </div>
             
             {/* Throttle Gauge */}
             <div className="bg-black/40 backdrop-blur p-3 rounded border border-white/10 w-40 relative overflow-hidden">
                 <div className="text-xs text-slate-400 uppercase relative z-10">Throttle</div>
                 <div className="text-xl font-mono text-white relative z-10">{(simState.throttle * 100).toFixed(0)}%</div>
                 <div 
                    className="absolute bottom-0 left-0 h-1.5 bg-orange-500 transition-all duration-75"
                    style={{ width: `${simState.throttle * 100}%` }}
                 />
             </div>
           </div>
        </div>

        {/* SAS Controls */}
        <div className="absolute top-4 left-[360px] pointer-events-auto flex flex-col space-y-2">
            <div className="bg-black/40 backdrop-blur p-2 rounded border border-white/10">
                <div className="text-[10px] text-slate-400 uppercase mb-1 font-bold">SAS Control</div>
                <div className="flex flex-col space-y-2">
                    <button 
                        onClick={() => setSAS(SASMode.STABILITY)}
                        className={`flex items-center space-x-2 px-3 py-1.5 rounded text-sm font-bold transition-colors ${simState.sasMode === SASMode.STABILITY ? 'bg-cyan-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                    >
                        <CircleOff size={16} /> <span>Stability</span>
                    </button>
                    <button 
                        onClick={() => setSAS(SASMode.PROGRADE)}
                        className={`flex items-center space-x-2 px-3 py-1.5 rounded text-sm font-bold transition-colors ${simState.sasMode === SASMode.PROGRADE ? 'bg-green-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                    >
                        <ArrowUpCircle size={16} /> <span>Prograde</span>
                    </button>
                    <button 
                        onClick={() => setSAS(SASMode.RETROGRADE)}
                        className={`flex items-center space-x-2 px-3 py-1.5 rounded text-sm font-bold transition-colors ${simState.sasMode === SASMode.RETROGRADE ? 'bg-orange-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                    >
                        <ArrowDownCircle size={16} /> <span>Retrograde</span>
                    </button>
                    <button 
                        onClick={() => setSAS(SASMode.MANUAL)}
                        className={`flex items-center space-x-2 px-3 py-1.5 rounded text-sm font-bold transition-colors ${simState.sasMode === SASMode.MANUAL ? 'bg-red-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                    >
                        <Power size={16} /> <span>SAS OFF</span>
                    </button>
                </div>
            </div>
            
            {hasParachutes && (
                <button 
                    onClick={deployParachutes}
                    className="flex items-center justify-center space-x-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded font-bold shadow-lg transition-transform active:scale-95"
                >
                    <Umbrella size={18}/> <span>DEPLOY CHUTES</span>
                </button>
            )}
        </div>
        
        {/* NavBall */}
        <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2 pointer-events-none z-20">
             <NavBall 
                 rotation={simState.rotation}
                 position={simState.position}
                 velocity={simState.velocity}
                 sasMode={simState.sasMode}
             />
        </div>

        {/* Controls */}
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex items-center space-x-4">
            <button onClick={toggleSim} className="p-4 bg-green-600 hover:bg-green-500 rounded-full shadow-lg shadow-green-900/50 transition-transform active:scale-95">
                {simState.active ? <Pause fill="white" /> : <Play fill="white" className="ml-1" />}
            </button>
            <button onClick={handleStage} className="px-6 py-3 bg-yellow-600 hover:bg-yellow-500 rounded-full font-bold shadow-lg shadow-yellow-900/50 flex items-center transition-transform active:scale-95">
                <Layers className="mr-2" size={18}/> STAGE
            </button>
            <button onClick={() => setShowForces(prev => !prev)} className={`p-4 rounded-full shadow-lg transition-transform active:scale-95 ${showForces ? 'bg-indigo-600 shadow-indigo-900/50' : 'bg-slate-700 hover:bg-slate-600'}`}>
                <Move fill="white" size={18}/>
            </button>
            <button onClick={onExit} className="p-4 bg-red-600 hover:bg-red-500 rounded-full shadow-lg shadow-red-900/50 transition-transform active:scale-95">
                <Square fill="white" size={18}/>
            </button>
        </div>
        
        {/* Controls Help */}
        <div className="absolute top-4 right-80 text-white/50 text-xs pointer-events-none text-right">
            <div>Arrow Left/Right to Turn</div>
            <div>Shift/Ctrl to Throttle</div>
            <div>Z/X for Max/Cut Throttle</div>
            <div>P to Deploy Chutes</div>
            <div>Scroll to Zoom</div>
        </div>
      </div>
      
      {/* Sidebar */}
      <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col z-10">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-slate-200">Orbital Data</h3>
              <button onClick={onExit}><X size={20} className="text-slate-400 hover:text-white"/></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="bg-black/50 p-2 rounded border border-slate-800 h-32">
                  <div className="text-[10px] text-slate-500 mb-1">ALTITUDE</div>
                  <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={telemetry}>
                          <YAxis hide domain={['auto', 'auto']}/>
                          <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', fontSize: '12px'}} itemStyle={{color: '#06b6d4'}} formatter={(value: number) => [value.toFixed(0) + 'm', 'Alt']}/>
                          <Area type="monotone" dataKey="altitude" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.1} isAnimationActive={false} strokeWidth={2}/>
                      </AreaChart>
                  </ResponsiveContainer>
              </div>
              <div className="bg-black/50 p-2 rounded border border-slate-800 h-32">
                   <div className="text-[10px] text-slate-500 mb-1">VELOCITY</div>
                  <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={telemetry}>
                          <YAxis hide domain={['auto', 'auto']}/>
                          <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', fontSize: '12px'}} itemStyle={{color: '#8b5cf6'}} formatter={(value: number) => [value.toFixed(0) + 'm/s', 'Vel']}/>
                          <Area type="monotone" dataKey="velocity" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} isAnimationActive={false} strokeWidth={2}/>
                      </AreaChart>
                  </ResponsiveContainer>
              </div>
               <div className="bg-black/50 p-2 rounded border border-slate-800 h-32">
                   <div className="text-[10px] text-slate-500 mb-1">VERTICAL SPEED</div>
                  <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={telemetry}>
                          <YAxis hide domain={['auto', 'auto']}/>
                          <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', fontSize: '12px'}} itemStyle={{color: '#10b981'}} formatter={(value: number) => [value.toFixed(0) + 'm/s', 'V.Spd']}/>
                          <Area type="monotone" dataKey="verticalVelocity" stroke="#10b981" fill="#10b981" fillOpacity={0.1} isAnimationActive={false} strokeWidth={2}/>
                      </AreaChart>
                  </ResponsiveContainer>
              </div>
              <div className="bg-black/50 p-2 rounded border border-slate-800 h-32">
                   <div className="text-[10px] text-slate-500 mb-1">HORIZONTAL SPEED</div>
                  <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={telemetry}>
                          <YAxis hide domain={['auto', 'auto']}/>
                          <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', fontSize: '12px'}} itemStyle={{color: '#f59e0b'}} formatter={(value: number) => [value.toFixed(0) + 'm/s', 'H.Spd']}/>
                          <Area type="monotone" dataKey="horizontalVelocity" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} isAnimationActive={false} strokeWidth={2}/>
                      </AreaChart>
                  </ResponsiveContainer>
              </div>

              <div className="bg-black/50 border border-slate-800 rounded h-64 flex flex-col">
                  <div className="p-2 border-b border-slate-800 bg-slate-800/30 text-xs font-bold text-slate-400">Mission Log</div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs">
                      {simState.events.map((e, i) => (
                          <div key={i} className="text-slate-300 border-l-2 border-cyan-500 pl-2 py-0.5">{e}</div>
                      ))}
                  </div>
              </div>
              <button onClick={resetSim} className="w-full py-2 border border-slate-700 rounded text-slate-300 hover:bg-slate-800 flex items-center justify-center text-sm">
                  <RotateCcw size={14} className="mr-2"/> Reset Launch
              </button>
          </div>
      </div>
    </div>
  );
};