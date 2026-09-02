/**
 * Iconografía en SVG en línea: un único trazo, sin dependencias y nítida a
 * cualquier tamaño. Todos heredan `currentColor`.
 */
type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IconFolder = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);

export const IconFile = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </svg>
);

export const IconImage = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 16-4.5-4.5L7 21" />
  </svg>
);

export const IconVideo = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="5" width="14" height="14" rx="2" />
    <path d="m17 10 4-2.5v9L17 14" />
  </svg>
);

export const IconAudio = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </svg>
);

export const IconArchive = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="4" width="18" height="5" rx="1.5" />
    <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M11 13h2" />
  </svg>
);

export const IconDoc = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

export const IconChevronRight = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="m9 6 6 6-6 6" /></svg>
);

export const IconChevronDown = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="m6 9 6 6 6-6" /></svg>
);

export const IconArrowUp = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);

export const IconArrowLeft = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
);

export const IconSearch = ({ size = 16 }: P) => (
  <svg {...base(size)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);

export const IconPlus = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
);

export const IconNewFolder = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M12 11v5M9.5 13.5h5" />
  </svg>
);

export const IconCopy = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
);

export const IconMove = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M10 13h6m-2.5-2.5L16 13l-2.5 2.5" /></svg>
);

export const IconTrash = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h10l1-13" /></svg>
);

export const IconDownload = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M12 4v11M8 11l4 4 4-4M5 20h14" /></svg>
);

export const IconRename = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M4 20h16M6.5 15.5 16 6a2.1 2.1 0 0 1 3 3l-9.5 9.5-4 1Z" /></svg>
);

export const IconClose = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);

export const IconRefresh = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M20 11a8 8 0 1 0-.6 4M20 5v6h-6" /></svg>
);

export const IconCloud = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M7 18a4 4 0 0 1-.4-8A6 6 0 0 1 18 9.5a3.5 3.5 0 0 1-.5 8.5Z" />
  </svg>
);

export const IconHome = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
);
