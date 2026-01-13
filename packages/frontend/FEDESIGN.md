# Plexus UI Frontend - Design Document

## 1. Overview & Architecture

### Tech Stack
- **Framework**: React with TypeScript
- **Routing**: React Router DOM
- **State Management**: React Context API (AuthContext, SidebarContext)
- **Charts**: Recharts for data visualization
- **Code Editor**: Monaco Editor for YAML/JSON editing
- **Icons**: Lucide React

### Project Structure
```
src/
├── pages/           # Page components (Dashboard, Usage, Logs, etc.)
├── components/      # Reusable UI components
│   ├── layout/      # MainLayout, Sidebar
│   ├── ui/          # Base components (Card, Button, Input, etc.)
│   └── dashboard/   # Dashboard-specific components
├── contexts/        # React Context providers
├── lib/             # Utilities and API client
└── assets/          # Static assets (logos, icons)
```

## 2. Design System

### Typography
```css
--font-heading: 'Space Grotesk', sans-serif;  /* Headings */
--font-body: 'DM Sans', sans-serif;           /* Body text */
```

### Spacing & Layout
```css
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 12px;
--spacing-lg: 16px;
--spacing-xl: 24px;

--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 16px;
--radius-xl: 20px;
```

## 3. Core Components

### Button Component (`components/ui/Button.tsx`)
**Purpose**: Primary action button with multiple variants

**Variants**:
- `primary`: Gradient with shadow
- `secondary`: Glass background with border
- `ghost`: Transparent with hover effect
- `danger`: Destructive actions

**Sizes**:
- `sm`: Small (`!py-1.5 !px-3.5 !text-xs`)
- `md`: Medium (default)
- `lg`: Large

**Styling**:
```css
Base: inline-flex items-center justify-center gap-2 py-2.5 px-5 font-body text-sm font-medium leading-normal border-0 rounded-md cursor-pointer transition-all duration-200 whitespace-nowrap select-none outline-none

Primary: text-black shadow-md bg-gradient-to-br from-primary to-secondary

Secondary: bg-bg-glass border border-border-glass backdrop-blur-md hover:bg-bg-hover

Ghost: bg-transparent border-0

Danger: bg-danger text-white shadow-md hover:-translate-y-0.5
```

### Card Component (`components/ui/Card.tsx`)
**Purpose**: Content container with glass effect

**Styling**:
```css
glass-bg backdrop-blur-md border border-white/10 rounded-lg shadow-xl overflow-hidden transition-all duration-300 max-w-full

Header: flex items-center justify-between px-6 py-5 border-b border-border-glass
Content: p-6 max-w-full
```

### Input Component (`components/ui/Input.tsx`)
**Purpose**: Form input with focus styles

**Styling**:
```css
wrapper: flex flex-col gap-2
label: font-body text-[13px] font-medium text-text-secondary
input: w-full py-2.5 px-3.5 font-body text-sm bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md
```

### Badge Component (`components/ui/Badge.tsx`)
**Purpose**: Status indicator with dot

**Statuses**:
- `connected`: Success state with dot
- `disconnected/error`: Error state with dot
- `warning`: Warning state with dot
- `neutral`: Default styling

**Styling**:
```css
inline-flex items-center gap-2 py-1.5 px-3 rounded-xl text-xs font-medium
Connected: text-success border border-success/30
Error: text-danger border border-danger/30
```

### Switch Component (`components/ui/Switch.tsx`)
**Purpose**: Toggle switch with smooth animation

**Styling**: Custom styled toggle with CSS transitions

### Modal Component (`components/ui/Modal.tsx`)
**Purpose**: Overlay modal with backdrop blur

**Sizes**:
- `sm`: 400px width
- `md`: 600px width (default)
- `lg`: 800px width

**Styling**:
```css
Backdrop: fixed inset-0 flex items-center justify-center z-[1000] p-5 bg-black/70 backdrop-blur-md

Modal: bg-bg-surface border border-border-glass rounded-xl max-w-full max-h-[90vh] overflow-hidden flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.5)]
```

### Tooltip Component (`components/ui/Tooltip.tsx`)
**Purpose**: Hover tooltip with positioning

**Positions**: `bottom` (default), `right`

## 4. Page-by-Page Analysis

### Dashboard (`pages/Dashboard.tsx`)
**Intent**: System overview with real-time metrics

**Layout**:
- Full-width page with gradient background
- Header with title and system status badge
- 5-column grid for stat cards
- Optional service alerts card (when cooldowns exist)
- Recent activity chart card

**Components Used**:
- Card, Badge, Button
- RecentActivityChart
- Lucide icons: Activity, Server, Zap, Database

**Data Displayed**:
- Real-time stats (requests, tokens, latency)
- Today's metrics (requests, tokens, cost)
- Service alerts for provider cooldowns
- Recent activity chart (requests + tokens over time)

**Interactive Elements**:
- Time range buttons (hour/day/week/month)
- Clear cooldowns button
- Auto-refresh every 30 seconds

**Tailwind Classes**:
```css
Page: min-h-screen p-6 transition-all duration-300

Stats Grid: grid grid-cols-5 gap-4 mb-6

Stat Card: glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300

Alert Card: alert-card
```

### Usage (`pages/Usage.tsx`)
**Intent**: Comprehensive usage analytics with charts

**Layout**:
- 4-column grid layout
- 8 chart cards (various combinations)

**Components Used**:
- Card, Button
- Recharts: AreaChart, PieChart

**Charts**:
- Requests over Time (AreaChart)
- Token Usage (Stacked AreaChart)
- Model Distribution (PieCharts)
- Provider Distribution (PieCharts)
- API Key Distribution (PieCharts)

**Interactive Elements**:
- Time range selector buttons
- Hover tooltips with formatted data

**Styling**:
```css
Charts: height 300px with custom tooltip styling
```

### Logs (`pages/Logs.tsx`)
**Intent**: Detailed request logs with real-time updates

**Layout**:
- Search/filter card
- Table with horizontal scroll
- Pagination controls

**Table Columns**:
Date | Key | Source IP | API | Model | Tokens | Cost | Performance | Mode | Status | Debug | Error | Delete

**Components Used**:
- Card, Button, Input, Badge, Modal, CostToolTip
- Lucide icons for status indicators

**Interactive Elements**:
- Search filters (model, provider)
- Pagination (prev/next)
- Delete individual logs
- Delete all logs modal
- Real-time SSE updates (when on first page)
- Debug/Error navigation buttons

**Special Features**:
- Copy-to-clipboard for model names
- Cost tooltip with pricing source details
- Status badges with icons
- Group hover effects for delete buttons

### Providers (`pages/Providers.tsx`)
**Intent**: Provider configuration management

**Layout**:
- Provider list table
- Large modal for add/edit provider

**Table Columns**:
ID/Name | Status | APIs | Actions

**Modal Sections**:
- Basic Info (ID, Name, Enabled)
- API Support & Base URLs (checkboxes + inputs)
- API Key
- Advanced (discount, headers, extraBody)
- Models (accordion with pricing config)

**Components Used**:
- Card, Button, Input, Switch, Badge, Modal
- Accordion using Chevron icons

**Interactive Elements**:
- Enable/disable toggle
- Add/edit/delete providers
- API type selection
- Model management with pricing

### Models (`pages/Models.tsx`)
**Intent**: Model alias and routing configuration

**Layout**:
- Search input card
- Alias list table
- Modal for add/edit alias

**Table Columns**:
Alias | Aliases | Selector | Targets

**Modal Sections**:
- Basic Info (ID, Selector Strategy)
- Additional Aliases (list)
- Targets (provider/model pairs)

**Components Used**:
- Card, Button, Input, Modal

**Interactive Elements**:
- Search filtering
- Add/remove aliases
- Add/remove targets
- Provider/model selection

### Keys (`pages/Keys.tsx`)
**Intent**: API key management

**Layout**:
- Search input card
- Keys table
- Modal for add/edit key

**Table Columns**:
Key Name | Secret | Comment | Actions

**Modal Fields**:
- Key Name (ID)
- Secret (with generate button)
- Comment

**Components Used**:
- Card, Button, Input, Modal

**Interactive Elements**:
- Search filtering
- Copy secret to clipboard
- Generate random keys
- Add/edit/delete keys

### Config (`pages/Config.tsx`)
**Intent**: Direct YAML configuration editing

**Layout**:
- Header with title and action buttons
- Monaco Editor container

**Components Used**:
- Button, Monaco Editor

**Interactive Elements**:
- YAML syntax highlighting
- Save/Reset buttons
- Real-time editing


### Debug (`pages/Debug.tsx`)
**Intent**: Request/response payload inspection

**Layout**:
- Two-pane layout (list + details)
- Accordion panels for different payload types

**Components Used**:
- Button, Modal, Monaco Editor
- Custom AccordionPanel component

**Interactive Elements**:
- Request list with timestamps
- Accordion panels for payloads
- Copy to clipboard
- Delete logs

**Payload Types**:
- Raw Request
- Transformed Request
- Raw Response
- Transformed Response
- Snapshots (when available)

### Errors (`pages/Errors.tsx`)
**Intent**: Error investigation and debugging

**Layout**: Similar to Debug page
- Two-pane layout
- Error details with stack traces

**Components Used**:
- Button, Modal, Monaco Editor
- Custom AccordionPanel

**Error Details**:
- Error message
- Stack trace
- Additional details (when available)


### Login (`pages/Login.tsx`)
**Intent**: Admin authentication

**Layout**:
- Centered card with logo
- Password input form

**Components Used**:
- Card, Button, Input

**Styling**:
```css
Page: min-h-screen flex items-center justify-center p-4
Card: max-width 600px, centered
```

## 5. Layout System

### MainLayout (`components/layout/MainLayout.tsx`)
- Sidebar + main content structure
- Handles collapsed state margins
- Smooth transitions

### Sidebar (`components/layout/Sidebar.tsx`)
**Width**: 
- Expanded: 200px
- Collapsed: 64px

**Sections**:
1. **Main**: Dashboard, Usage, Logs
2. **Configuration**: Providers, Models, Keys, OAuth, Settings, System Logs
3. **System**: Debug Mode toggle, Debug Traces, Errors, Logout

**Features**:
- Collapsible with localStorage persistence
- Tooltip support when collapsed
- Active state highlighting
- Debug mode toggle with confirmation modal

## 6. Visual Effects & Animations

### CSS Animations
```css
/* Pulse fade for new log entries */
@keyframes pulse-fade {
  0% { background-color: rgba(0, 0, 0, 0.1); }
  100% { background-color: transparent; }
}

/* Modal animations */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
```

### Hover Effects
- Buttons: `-translate-y-0.5` with shadow increase
- Cards: Subtle glow effects
- Table rows: `hover:bg-bg-hover`
- Glass effects: Backdrop blur with transparency

### Transitions
- Sidebar collapse: `duration-300`
- Page transitions
- All interactive elements: `transition-all duration-200`

## 7. Data Visualization Patterns

### Chart Styling
```css
CartesianGrid: stroke="#888" strokeOpacity={0.1}
XAxis/YAxis: tick={{ fontSize: 12 }} axisLine={false} tickLine={false}
Tooltip: Custom styling
```

## 8. Responsive Design

### Breakpoints
- Mobile-first approach
- Table horizontal scrolling
- Grid layouts adapt to screen size
- Sidebar collapsible on smaller screens

### Mobile Considerations
- Touch-friendly buttons (min 44px)
- Horizontal scrolling tables
- Stacked layouts on mobile

## 9. State Management Patterns

### AuthContext
- Stores admin key in localStorage
- Provides login/logout functions
- Redirects on authentication failure

### SidebarContext
- Manages collapsed state
- Persists to localStorage
- Provides toggle function

## 10. API Integration Patterns

### Fetch Wrapper
- Automatic auth header injection

### Real-time Updates
- Server-Sent Events (SSE) 
- Polling intervals for stats (30s)

### Error Handling
- Console error logging
- User-friendly error messages
- Graceful degradation

## 11. Unique Design Elements


### Technical Precision
- Precise spacing and alignment
- Monospace fonts for IDs/keys
- Detailed tooltips
- Status indicators everywhere

## 12. Implementation Notes

### Component Hierarchy
```
App
├── AuthProvider
│   └── SidebarProvider
│       └── ProtectedRoute
│           └── MainLayout
│               ├── Sidebar
│               └── Router Pages
│                   ├── Dashboard
│                   ├── Usage
│                   ├── Logs
│                   └── ...
```

### Key Dependencies
```json
{
  "lucide-react": "^0.468.0",
  "monaco-editor": "^0.52.2",
  "openapi-fetch": "^0.13.0",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-router-dom": "^6.28.0",
  "recharts": "^2.14.1"
}
```

### Build Configuration
- Bun auto build
- Monaco Editor workers configured
- CSS variables and custom properties
