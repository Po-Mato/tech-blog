import dynamic from 'next/dynamic';
import React from 'react';

const Universe = dynamic(() => import('./Universe'), { ssr: false });

const DynamicUniverse: React.FC = () => {
  return <Universe />;
};

export default DynamicUniverse;
