import * as React from "react"
import {
  ResponsiveContainer,
  RadialBarChart as ReRadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from "recharts"
import { cn } from "../../lib/utils"

interface GaugeChartProps {
  value: number
  max?: number
  label?: string
  unit?: string
  className?: string
  size?: number
}

const GaugeChart = React.forwardRef<HTMLDivElement, GaugeChartProps>(
  ({ value, max = 100, label = "", unit = "", className, size = 200 }, ref) => {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100))

    const data = [
      { name: label, value: percentage, fill: getColor(percentage) },
    ]

    function getColor(pct: number): string {
      if (pct < 60) return "#10b981"
      if (pct < 80) return "#f59e0b"
      return "#ef4444"
    }

    return (
      <div ref={ref} className={cn("relative flex flex-col items-center", className)}>
        <div style={{ width: size, height: size * 0.6 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ReRadialBarChart
              innerRadius="60%"
              outerRadius="100%"
              data={data}
              startAngle={180}
              endAngle={0}
              cx="50%"
              cy="100%"
            >
              <PolarAngleAxis
                type="number"
                domain={[0, 100]}
                angleAxisId={0}
                tick={false}
              />
              <RadialBar
                background
                dataKey="value"
                cornerRadius={6}
                fill={getColor(percentage)}
                className="transition-all duration-500 ease-out"
              />
            </ReRadialBarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-center -mt-4">
          <div
            className="text-3xl font-bold"
            style={{ color: getColor(percentage) }}
          >
            {value.toFixed(1)}
            <span className="text-lg">{unit}</span>
          </div>
          {label && (
            <div className="text-sm text-muted-foreground uppercase tracking-wider">
              {label}
            </div>
          )}
        </div>
      </div>
    )
  }
)
GaugeChart.displayName = "GaugeChart"

export { GaugeChart }
