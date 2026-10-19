type P = { size?: number; className?: string; style?: React.CSSProperties };
const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const UploadCloud = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M7 18a4.5 4.5 0 0 1-.5-8.97A5.5 5.5 0 0 1 17.3 7.1 4 4 0 0 1 17 15" />
    <path d="M12 12v7" />
    <path d="m9 15 3-3 3 3" />
  </svg>
);

export const Mic = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3M9 21h6" />
  </svg>
);

export const PlayCircle = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="12" cy="12" r="9.3" />
    <path d="M10.3 9.2v5.6l4.7-2.8z" fill="currentColor" stroke="none" />
  </svg>
);

export const Play = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M7 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
  </svg>
);

export const Pause = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const ChevronRight = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const Check = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M5 12.5 9.5 17 19 7" />
  </svg>
);

export const ArrowLeft = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const Search = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const AlertTriangle = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M12 3.5 2 20.5h20z" />
    <path d="M12 10v4M12 17.3h.01" />
  </svg>
);

export const TrendUp = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="m4 15 6-6 4 4 7-8" />
    <path d="M15 5h6v6" />
  </svg>
);

export const TrendDown = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="m4 9 6 6 4-4 7 8" />
    <path d="M15 19h6v-6" />
  </svg>
);

export const Minus = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M5 12h14" />
  </svg>
);

export const Users = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c.8-3.4 3-5 5.5-5s4.7 1.6 5.5 5" />
    <circle cx="17.3" cy="9" r="2.4" />
    <path d="M15.7 14.3c2 .3 3.5 1.8 4.1 4.3" />
  </svg>
);

export const Grid = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.8" />
    <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.8" />
    <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8" />
    <rect x="13" y="13" width="7.5" height="7.5" rx="1.8" />
  </svg>
);

export const Plus = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Headset = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
    <rect x="3" y="13" width="4" height="6" rx="1.5" />
    <rect x="17" y="13" width="4" height="6" rx="1.5" />
    <path d="M19 19v1a3 3 0 0 1-3 3h-3" />
  </svg>
);

export const Target = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const Repeat = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M4 7.5h12a3.5 3.5 0 0 1 3.5 3.5v1" />
    <path d="m14 4 3 3.5-3 3.5" />
    <path d="M20 16.5H8A3.5 3.5 0 0 1 4.5 13v-1" />
    <path d="m10 20-3-3.5 3-3.5" />
  </svg>
);
