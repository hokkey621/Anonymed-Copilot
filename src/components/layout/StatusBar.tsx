interface StatusBarProps {
    riskPercentage?: number;
    status?: string;
}

export function StatusBar({ riskPercentage = 0.01, status = "Ready" }: StatusBarProps) {
    const riskColor = riskPercentage < 1 ? "bg-green-400" : riskPercentage < 10 ? "bg-yellow-400" : "bg-red-400";
    const riskLabel = riskPercentage < 1 ? "Extremely Low" : riskPercentage < 10 ? "Low" : "High";

    return (
        <div className="h-8 border-t bg-primary text-primary-foreground flex items-center px-4 text-xs justify-between">
            <div className="flex items-center gap-4">
                <span className="font-semibold">Re-identification Risk</span>
                <div className="h-2 w-24 bg-white/20 rounded-full overflow-hidden">
                    <div className={`h-full ${riskColor}`} style={{ width: `${Math.min(riskPercentage, 100)}%` }} />
                </div>
                <span className="text-green-200">{riskLabel} {riskPercentage.toFixed(2)}%</span>
            </div>
            <div className="flex items-center gap-4">
                <span>{status}</span>
            </div>
        </div>
    );
}
