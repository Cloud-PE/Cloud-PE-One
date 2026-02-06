import React from 'react';
import { Button } from '@/components/ui/button';

interface PlaceholderPageProps {
  title: string;
}

const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ title }) => {
  return (
    <div className="p-6 flex flex-col items-center justify-center h-[calc(100%-24px)] min-h-[300px]">
      <h2 className="text-2xl font-bold mb-6">{title}</h2>
      <Button>test</Button>
    </div>
  );
};

export default PlaceholderPage;
