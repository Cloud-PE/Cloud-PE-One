import React, { useEffect, useRef } from 'react';
import { Spinner } from '@/components/ui/spinner';

const DocsPage: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = React.useState(true);

  useEffect(() => {
    const handleIframeLoad = () => {
      setLoading(false);
    };

    const iframe = iframeRef.current;
    if (iframe) {
      iframe.addEventListener('load', handleIframeLoad);
    }

    return () => {
      if (iframe) {
        iframe.removeEventListener('load', handleIframeLoad);
      }
    };
  }, []);

  return (
    <div className="h-[calc(100vh-48px)] relative overflow-hidden">
      {loading && (
        <div className="absolute inset-0 flex justify-center items-center bg-background z-10">
          <Spinner className="size-8" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        src="https://docs.cloud-pe.cn"
        className="w-full h-full border-none"
        title="Cloud-PE 文档"
      />
    </div>
  );
};

export default DocsPage;
