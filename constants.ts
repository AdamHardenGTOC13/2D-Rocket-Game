import { PartType, RocketPartDef } from './types';

// Helper to generate standard stack nodes
const stackNodes = (w: number, h: number) => [
  { id: 'top', x: 0, y: -h/2, type: 'stack' as const },
  { id: 'bottom', x: 0, y: h/2, type: 'stack' as const }
];

// Helper for radial nodes on tanks
const tankNodes = (w: number, h: number) => [
  ...stackNodes(w, h),
  { id: 'left', x: -w/2, y: 0, type: 'radial' as const },
  { id: 'right', x: w/2, y: 0, type: 'radial' as const }
];

export const AVAILABLE_PARTS: RocketPartDef[] = [
  {
    id: 'cmd-mk1',
    name: 'Command Pod Mk1',
    type: PartType.COMMAND,
    mass: 800,
    dragCoeff: 0.2,
    cost: 1000,
    description: 'Basic capsule for a single pilot.',
    height: 1.5,
    width: 1.5,
    nodes: [
      { id: 'bottom', x: 0, y: 0.75, type: 'stack' },
      { id: 'top', x: 0, y: -0.75, type: 'stack', allowedTypes: [PartType.NOSE, PartType.DECOUPLER, PartType.PARACHUTE, PartType.STRUCTURAL] } 
    ]
  },
  {
    id: 'chute-mk1',
    name: 'Mk16 Parachute',
    type: PartType.PARACHUTE,
    mass: 100,
    dragCoeff: 0.5, 
    cost: 400,
    description: 'Essential for safe landings.',
    height: 0.4,
    width: 0.8,
    nodes: [
        { id: 'bottom', x: 0, y: 0.2, type: 'stack' }
    ]
  },
  {
    id: 'nose-basic',
    name: 'Aerodynamic Nose Cone',
    type: PartType.NOSE,
    mass: 100,
    dragCoeff: 0.1,
    cost: 200,
    description: 'Reduces drag at the top of a stack.',
    height: 1.2,
    width: 1.2,
    nodes: [
      { id: 'bottom', x: 0, y: 0.6, type: 'stack' }
    ]
  },
  {
    id: 'tank-s',
    name: 'FL-T100 Fuel Tank',
    type: PartType.TANK,
    mass: 60, 
    fuelCapacity: 500,
    dragCoeff: 0.2,
    cost: 150,
    description: 'Small fuel tank.',
    height: 1.0,
    width: 1.2,
    nodes: tankNodes(1.2, 1.0)
  },
  {
    id: 'tank-m',
    name: 'FL-T400 Fuel Tank',
    type: PartType.TANK,
    mass: 250, 
    fuelCapacity: 2000,
    dragCoeff: 0.2,
    cost: 500,
    description: 'Medium reliable fuel tank.',
    height: 2.0,
    width: 1.2,
    nodes: tankNodes(1.2, 2.0)
  },
  {
    id: 'tank-l',
    name: 'Rockomax Jumbo-64',
    type: PartType.TANK,
    mass: 1000, 
    fuelCapacity: 8000,
    dragCoeff: 0.3,
    cost: 2500,
    description: 'Heavy lift fuel tank.',
    height: 4.0,
    width: 2.5,
    nodes: tankNodes(2.5, 4.0)
  },
  {
    id: 'struct-girder',
    name: 'Modular Girder',
    type: PartType.STRUCTURAL,
    mass: 120,
    dragCoeff: 0.8,
    cost: 100,
    description: 'Lightweight truss for spacing parts.',
    height: 1.5,
    width: 0.8,
    nodes: [
        ...stackNodes(0.8, 1.5),
        { id: 'mid-l', x: -0.4, y: 0, type: 'radial' },
        { id: 'mid-r', x: 0.4, y: 0, type: 'radial' }
    ]
  },
  {
    id: 'eng-swivel',
    name: 'LV-T45 "Swivel"',
    type: PartType.ENGINE,
    mass: 1500,
    thrust: 215000, 
    burnRate: 80, 
    dragCoeff: 0.2,
    cost: 1200,
    description: 'Reliable liquid fuel engine.',
    height: 1.5,
    width: 1.2,
    nodes: [
      { id: 'top', x: 0, y: -0.75, type: 'stack' },
      { id: 'bottom', x: 0, y: 0.75, type: 'stack' } // Can chain?
    ]
  },
  {
    id: 'eng-mainsail',
    name: 'RE-M3 "Mainsail"',
    type: PartType.ENGINE,
    mass: 6000,
    thrust: 1500000, 
    burnRate: 400,
    dragCoeff: 0.3,
    cost: 13000,
    description: 'Massive power.',
    height: 3.0,
    width: 2.5,
    nodes: [
      { id: 'top', x: 0, y: -1.5, type: 'stack' },
      { id: 'bottom', x: 0, y: 1.5, type: 'stack' }
    ]
  },
  {
    id: 'decoupler-s',
    name: 'TR-18A Stack Decoupler',
    type: PartType.DECOUPLER,
    mass: 50,
    dragCoeff: 0.1,
    cost: 400,
    description: 'Separate stages vertically.',
    height: 0.4,
    width: 1.2,
    nodes: stackNodes(1.2, 0.4)
  },
  {
    id: 'decoupler-r',
    name: 'TT-38K Radial Decoupler',
    type: PartType.DECOUPLER,
    mass: 75,
    dragCoeff: 0.3,
    cost: 600,
    description: 'Side-mounted separator for boosters.',
    height: 0.8,
    width: 0.4,
    nodes: [
       { id: 'root', x: -0.2, y: 0, type: 'radial' }, // Connects to tank
       { id: 'attach', x: 0.2, y: 0, type: 'radial' } // Connects to booster
    ]
  },
  {
    id: 'fin-basic',
    name: 'AV-R8 Winglet',
    type: PartType.FIN,
    mass: 50,
    dragCoeff: 0.4, 
    cost: 300,
    description: 'Atmospheric stability.',
    height: 1.0,
    width: 0.5,
    nodes: [
       { id: 'root', x: -0.25, y: 0, type: 'radial' }
    ]
  },
  {
    id: 'leg-lt1',
    name: 'LT-1 Landing Strut',
    type: PartType.LEG,
    mass: 80,
    dragCoeff: 0.3,
    cost: 450,
    description: 'Extendable legs for landing.',
    height: 1.2,
    width: 0.4,
    nodes: [
        { id: 'root', x: -0.2, y: -0.4, type: 'radial' } // Attach point near top
    ]
  }
];