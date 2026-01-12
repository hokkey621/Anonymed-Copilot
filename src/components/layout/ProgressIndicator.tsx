import { Brain, Zap, CheckCircle2, RotateCcw } from 'lucide-react';

export interface AgentProgressEvent {
  step: string;
  status: string;
  message: string;
}

interface ProgressIndicatorProps {
  currentStep: string;
  status: string;
  message: string;
}

export function ProgressIndicator({ currentStep, status, message }: ProgressIndicatorProps) {
  const steps = [
    { id: 'Planner', label: 'Plan', icon: Brain },
    { id: 'Executor', label: 'Execute', icon: Zap },
    // { id: 'Reviewer', label: 'Review', icon: CheckCircle2 }, // Future
  ];

  const getCurrentStepIndex = () => {
    return steps.findIndex(s => s.id === currentStep);
  };

  const stepIndex = getCurrentStepIndex();

  return (
    <div className="w-full bg-slate-50 dark:bg-slate-900 border rounded-lg p-3 my-2 shadow-sm">
      <div className="flex items-center justify-between mb-3 px-1">
        {steps.map((step, idx) => (
          <div key={step.id} className="flex flex-col items-center relative z-10 w-full">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300
              ${currentStep === step.id
                ? 'bg-blue-500 text-white scale-110 shadow-md ring-2 ring-blue-200 dark:ring-blue-900'
                : idx < stepIndex || (idx === stepIndex && status === 'Completed')
                  ? 'bg-green-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
              }`}>
              <step.icon size={14} className={currentStep === step.id && status === 'In Progress' ? 'animate-pulse' : ''} />
            </div>
            <span className={`text-[10px] mt-1 font-medium transition-colors
              ${currentStep === step.id ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}>
              {step.label}
            </span>

            {/* Connector Line */}
            {idx < steps.length - 1 && (
              <div className="absolute top-4 left-[50%] w-full h-[2px] -z-10 bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: idx < stepIndex ? '100%' : '0%' }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Dynamic Status Message */}
      <div className="bg-white dark:bg-slate-800 rounded px-3 py-2 text-xs flex items-center gap-2 border border-slate-100 dark:border-slate-700">
        {status === 'In Progress' ? (
          <RotateCcw size={12} className="animate-spin text-blue-500" />
        ) : (
          <CheckCircle2 size={12} className="text-green-500" />
        )}
        <span className="text-slate-600 dark:text-slate-300 truncate">
          {message}
        </span>
      </div>
    </div>
  );
}
