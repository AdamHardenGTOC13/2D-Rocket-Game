import React, { useState } from 'react';
import { Builder } from './components/Builder';
import { Simulation } from './components/Simulation';
import { RocketPart } from './types';

function App() {
  const [mode, setMode] = useState<'BUILD' | 'SIM'>('BUILD');
  const [rocketParts, setRocketParts] = useState<RocketPart[]>([]);

  const handleLaunch = () => {
    setMode('SIM');
  };

  const handleExitSim = () => {
    setMode('BUILD');
  };

  return (
    <div className="w-full h-full">
      {mode === 'BUILD' ? (
        <Builder 
          parts={rocketParts} 
          onPartsChange={setRocketParts} 
          onLaunch={handleLaunch} 
        />
      ) : (
        <Simulation 
          initialParts={rocketParts} 
          onExit={handleExitSim} 
        />
      )}
    </div>
  );
}

export default App;
