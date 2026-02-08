type SparklineProps = {
  data: number[];
  height?: number;
  stroke?: string;
  fill?: string;
};

export function Sparkline({
  data,
  height = 120,
  stroke = "#3B82F6",
  fill = "rgba(59, 130, 246, 0.15)"
}: SparklineProps) {
  const width = 300;
  const safeData = data.length ? data : [0];
  const min = Math.min(...safeData);
  const max = Math.max(...safeData);
  const range = max - min || 1;
  const points = safeData.map((value, index) => {
    const x = (index / Math.max(1, safeData.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return [x, y];
  });

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point[0]},${point[1]}`)
    .join(" ");

  const area = `${line} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-28 w-full"
      preserveAspectRatio="none"
    >
      <path d={area} fill={fill} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={2} />
    </svg>
  );
}

type BarRow = {
  label: string;
  value: number;
};

type BarListProps = {
  rows: BarRow[];
  formatValue?: (value: number) => string;
};

export function BarList({ rows, formatValue }: BarListProps) {
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const width = (Math.abs(row.value) / max) * 100;
        const positive = row.value >= 0;
        const label = formatValue
          ? formatValue(row.value)
          : `${row.value >= 0 ? "+" : "-"}$${Math.abs(row.value).toFixed(0)}`;
        return (
          <div key={row.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{row.label}</span>
              <span className={positive ? "text-positive" : "text-negative"}>
                {label}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/5">
              <div
                className={`h-2 rounded-full ${
                  positive ? "bg-positive" : "bg-negative"
                }`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

type DonutChartProps = {
  value: number; // 0..1
  size?: number;
  stroke?: string;
  track?: string;
};

export function DonutChart({
  value,
  size = 86,
  stroke = "#3B82F6",
  track = "rgba(148, 163, 184, 0.2)"
}: DonutChartProps) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));
  const offset = circumference * (1 - clamped);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={track}
        strokeWidth={8}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={stroke}
        strokeWidth={8}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
