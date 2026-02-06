import React from 'react';
import { Alert, AlertTitle, AlertDescription, AlertAction } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, X } from 'lucide-react';

interface BootDriveUpdateBannerProps {
  onNavigateToUpgrade: () => void;
  onClose: () => void;
}

const BootDriveUpdateBanner: React.FC<BootDriveUpdateBannerProps> = ({
  onClose,
}) => {
  return (
    <Alert variant="error">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>警告</AlertTitle>
      <AlertDescription>
        你的 Cloud-PE 不是最新版本，建议您<strong>立即升级</strong>
      </AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
          <X className="h-4 w-4" />
        </Button>
      </AlertAction>
    </Alert>
  );
};

export default BootDriveUpdateBanner;
