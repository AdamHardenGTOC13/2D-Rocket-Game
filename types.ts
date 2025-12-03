
export enum PartType {
  COMMAND = 'COMMAND',
  TANK = 'TANK',
  ENGINE = 'ENGINE',
  DECOUPLER = 'DECOUPLER',
  NOSE = 'NOSE',
  FIN = 'FIN',
  PAYLOAD = 'PAYLOAD',
  STRUCTURAL = 'STRUCTURAL',
  LEG = 'LEG',
  PARACHUTE = 'PARACHUTE'
}

export enum SASMode {
  MANUAL = 'MANUAL',
  STABILITY = 'STABILITY',
  PROGRADE = 'PROGRADE',
  RETROGRADE = 'RETROGRADE'
}

export interface AttachNode {
  id: string; // e.g., 'top', 'bottom', 'left', 'right'
  x: number; // Relative to part center
  y: number; // Relative to part center
  type: 'stack' | 'radial'; // 'stack' is vertical, 'radial' is side
  allowedTypes?: PartType[]; // If present, only these types can attach
}

export interface RocketPartDef {
  id: string;
  name: string;
  type: PartType;
  mass: number; // kg (dry mass)
  fuelCapacity?: number; // kg
  thrust?: number; // Newtons
  burnRate?: number; // kg/s
  dragCoeff: number;
  cost: number;
  description: string;
  height: number; // meters
  width: number; // meters
  nodes: AttachNode[]; // Defined connection points
}

export interface RocketPart extends RocketPartDef {
  instanceId: string;
  currentFuel?: number;
  
  // Tree Structure
  parentId?: string;
  parentNodeId?: string; // Which node on the parent we attached to
  
  // Symmetry
  symmetryId?: string; 
  radialOffset?: number; // -1 (Left/Mirrored) or 1 (Right/Standard)

  // Simulation State
  isThrusting?: boolean;
  isDeployed?: boolean; // For parachutes/legs
}

export interface Vector2 {
  x: number;
  y: number;
}

export interface Debris {
  id: string;
  parts: RocketPart[];
  position: Vector2;
  velocity: Vector2;
  rotation: number;
  angularVelocity: number;
  events?: string[];
}

export interface SimulationState {
  // Physics State
  position: Vector2; // World coordinates (0,0 is planet center)
  velocity: Vector2; 
  rotation: number; 
  angularVelocity: number; 
  throttle: number; // 0.0 to 1.0
  sasMode: SASMode;

  // Derived/Info
  altitude: number; 
  velocityMag: number; // Speed magnitude
  verticalVelocity: number; 
  horizontalVelocity: number;
  acceleration: number; 
  time: number; 

  // Orbital Elements
  semiMajorAxis: number;
  eccentricity: number;
  apoapsis: number;
  periapsis: number;
  
  parts: RocketPart[];
  debris: Debris[];
  active: boolean;
  finished: boolean;
  maxAltitude: number;
  events: string[];
  
  // Visualization
  forces?: {
      thrust: Vector2;
      gravity: Vector2;
      drag: Vector2;
  };
}

export interface TelemetryPoint {
  time: number;
  altitude: number;
  velocity: number;
  verticalVelocity: number;
  horizontalVelocity: number;
}