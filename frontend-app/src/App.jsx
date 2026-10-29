import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Gauge,
  LocateFixed,
  MapPinned,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const SUPABASE_URL = 'https://ccrhdrjywnaccthzyjte.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1J0WlsyCsKVjP4XPOt_keg_kj0ZAsny';
const apiBase = (import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:4000' : `${SUPABASE_URL}/functions/v1/civicpulse-api`)).replace(/\/+$/, '');
const DEFAULT_MAP_CENTER = [22.9734, 78.6569];

function formatRelativeTime(value) {
  if (!value) return 'time unavailable';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'time unavailable';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
  return new Date(timestamp).toLocaleDateString();
}

const workflow = [
  { id: '01', title: 'Snap', description: 'Citizens photograph the issue and pin its location.', icon: Camera },
  { id: '02', title: 'Score', description: 'AI detects the defect, measures coverage and assigns a 1-100 priority.', icon: Wand2 },
  { id: '03', title: 'Merge', description: 'Reports within 15 m of the same issue join one master ticket.', icon: MapPinned },
  { id: '04', title: 'Verify', description: 'Before/after photos prove the repair was actually done.', icon: Check },
];

function MapClickHandler({ onLocationChange }) {
  useMapEvents({ click(event) { onLocationChange(event.latlng.lat, event.latlng.lng); } });
  return null;
}

function MapCenterSync({ latitude, longitude }) {
  const map = useMap();
  useEffect(() => {
    if (latitude === '' || longitude === '') return;
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 0.35 });
  }, [map, latitude, longitude]);
  return null;
}

function LocationPickerMap({ latitude, longitude, onLocationChange }) {
  const hasLocation = latitude !== '' && longitude !== '' &&
    Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) &&
    Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180;
  const selectedPosition = hasLocation ? [Number(latitude), Number(longitude)] : null;
  return (
    <MapContainer className="location-map" center={selectedPosition || DEFAULT_MAP_CENTER} zoom={selectedPosition ? 15 : 5} scrollWheelZoom>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapClickHandler onLocationChange={onLocationChange} />
      {selectedPosition && (
        <>
          <MapCenterSync latitude={latitude} longitude={longitude} />
          <CircleMarker center={selectedPosition} radius={9} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 0.95 }}>
            <Popup>Selected incident location</Popup>
          </CircleMarker>
        </>
      )}
    </MapContainer>
  );
}

function FitTicketBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 13);
    else if (points.length > 1) map.fitBounds(points, { padding: [28, 28], maxZoom: 13 });
  }, [map, points]);
  return null;
}

function TicketMap({ tickets }) {
  const mappedTickets = tickets.map((ticket) => {
    const coordinates = ticket.location?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2) return null;
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { ticket, position: [lat, lng] };
  }).filter(Boolean);
  const points = mappedTickets.map((item) => item.position);
  return (
    <div className="ticket-map-wrap">
      <MapContainer className="ticket-map" center={points[0] || DEFAULT_MAP_CENTER} zoom={points.length ? 12 : 5} scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitTicketBounds points={points} />
        {mappedTickets.map(({ ticket, position }) => {
          const resolved = ticket.status === 'Resolved';
          const color = resolved ? '#16a34a' : ticket.severity === 'CRITICAL' ? '#dc2626' : ticket.severity === 'MEDIUM' ? '#d97706' : '#2563eb';
          return (
            <CircleMarker key={ticket._id} center={position} radius={8} pathOptions={{ color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 0.92 }}>
              <Popup><strong>{ticket.defect_type || 'Civic issue'}</strong><br />{ticket.status || 'Pending'} · {ticket.severity || 'LOW'}<br />Priority: {ticket.priority_score ?? 0}<br />{ticket.description || 'No description provided'}</Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="ticket-map-caption">{mappedTickets.length ? `${mappedTickets.length} mapped incident${mappedTickets.length === 1 ? '' : 's'}` : 'No mapped reports yet — the map will populate when reports are submitted.'}</div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <Chatbot />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/command-center" element={<CommandCenterPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </>
  );
}

function Chatbot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'bot',
      text: 'Hi! I am CivicPulse AI. Ask me about reporting a civic issue, dispatch flow, or what happens next after a report is submitted.',
    },
  ]);
  const [sending, setSending] = useState(false);

  const sendMessage = async (event) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const userMessage = { id: crypto.randomUUID(), sender: 'user', text: trimmed };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setSending(true);

    try {
      const response = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.message || 'Unable to reach the assistant.');
      }

      const reply = payload?.reply || 'I am here to help with later steps in the civic reporting flow.';
      setMessages((current) => [...current, { id: crypto.randomUUID(), sender: 'bot', text: reply }]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          sender: 'bot',
          text: error.message || 'The assistant is temporarily unavailable. Please try again in a moment.',
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button type="button" className="chat-button" onClick={() => setOpen((current) => !current)} aria-label="Open CivicPulse AI assistant">
        <Sparkles size={18} />
      </button>

      {open && (
        <div className="chat-panel" role="dialog" aria-modal="true" aria-label="CivicPulse AI assistant">
          <div className="chat-header">
            <div className="chat-title-wrap">
              <div className="chat-icon">
                <Sparkles size={16} />
              </div>
              <div>
                <div className="chat-title">CivicPulse AI</div>
                <div className="chat-subtitle">Available to help</div>
              </div>
            </div>
            <button type="button" className="chat-close" onClick={() => setOpen(false)} aria-label="Close assistant">
              <X size={16} />
            </button>
          </div>

          <div className="chat-thread">
            {messages.map((message) => (
              <div key={message.id} className={`chat-message ${message.sender}`}>
                {message.text}
              </div>
            ))}
          </div>

          <form className="chat-form" onSubmit={sendMessage}>
            <textarea
              rows="1"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about a civic issue..."
            />
            <button type="submit" className="chat-send" disabled={sending || !input.trim()}>
              <Send size={16} />
              {sending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function LandingPage() {
  return (
    <div className="page-shell">
      <header className="topbar">
        <Link to="/" className="brand-wrap brand-link">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <span className="brand-name">CivicPulse AI</span>
        </Link>

        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/report" className="nav-link">
            <Camera size={15} />
            Report
          </NavLink>
          <NavLink to="/command-center" className="nav-link">
            <MapPinned size={15} />
            Command Center
          </NavLink>
        </nav>
      </header>

      <main className="hero-shell">
        <div className="hero-copy">
          <p className="eyebrow">REAL-TIME CIVIC TRIAGE</p>

          <h1>
            Every pothole, <span>ranked</span>
            <br />
            and dispatched in
            <br />
            <span className="highlight">seconds.</span>
          </h1>

          <p className="subtext">
            CivicPulse turns citizen photos into scored, de-duplicated
            <br />
            work orders streaming live to the city command center.
          </p>

          <div className="cta-row">
            <Link to="/report" className="primary-btn">
              <Sparkles size={18} />
              Report an Issue
              <ArrowRight size={18} />
            </Link>

            <Link to="/command-center" className="secondary-btn">
              <MapPinned size={18} />
              Open command center
            </Link>
          </div>
        </div>

        <section className="flow-grid" aria-label="Issue workflow">
          {workflow.map((step) => {
            const Icon = step.icon;
            return (
              <article className="process-card" key={step.id}>
                <div className="card-head">
                  <div className="card-icon">
                    <Icon size={18} />
                  </div>
                  <span className="step-index">{step.id}</span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}

function ReportPage() {
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({ defect_type: 'pothole', latitude: '', longitude: '', landmark: '', description: '' });
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('Ready');
  const [submitting, setSubmitting] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState([]);
  const [searchingLocation, setSearchingLocation] = useState(false);

  const applyCameraOrFile = (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setStatus('Please choose a JPG, PNG, or WebP image.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setStatus('Image must be 8 MB or smaller.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result || '');
    reader.onerror = () => setStatus('The selected image could not be read. Please try another file.');
    reader.readAsDataURL(file);
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    applyCameraOrFile(file);
  };

  const searchLocation = async (event) => {
    event.preventDefault();
    const query = locationQuery.trim();
    if (query.length < 3) {
      setStatus('Enter at least 3 characters to search for a place.');
      return;
    }
    setSearchingLocation(true);
    setLocationResults([]);
    setStatus('Searching OpenStreetMap for this address...');
    try {
      const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', addressdetails: '1' });
      const response = await fetch('https://nominatim.openstreetmap.org/search?' + params.toString(), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Address search is temporarily unavailable. You can still tap the map to pin a location.');
      const results = await response.json();
      if (!Array.isArray(results) || results.length === 0) {
        setStatus('No matching places found. Try a nearby landmark or tap the map.');
        return;
      }
      setLocationResults(results.filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))));
      setStatus('Choose the matching place below, or tap directly on the map.');
    } catch (error) {
      setStatus(error.message || 'Could not search for this address.');
    } finally {
      setSearchingLocation(false);
    }
  };

  const chooseSearchResult = (result) => {
    const latitude = Number(result.lat);
    const longitude = Number(result.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      setStatus('That place returned invalid coordinates. Please choose another result.');
      return;
    }
    setForm((current) => ({ ...current, latitude: latitude.toFixed(6), longitude: longitude.toFixed(6), landmark: String(result.display_name || '').slice(0, 200) }));
    setLocationResults([]);
    setStatus('Place selected. Verify the pin on the map before submitting.');
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setStatus('Geolocation is not available in this browser.');
      return;
    }

    setStatus('Locating your device...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          latitude: position.coords.latitude.toFixed(5),
          longitude: position.coords.longitude.toFixed(5),
        }));
        setStatus('Location updated.');
      },
      () => {
        setStatus('Location access denied. Enter the coordinates manually to continue.');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const selectMapLocation = (latitude, longitude) => {
    setForm((current) => ({ ...current, latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) }));
    setStatus('Map pin selected. Confirm the location before submitting.');
  };

  const submitReport = async (event) => {
    event.preventDefault();
    if (!apiBase) {
      setStatus('Backend API is not configured. Set VITE_API_BASE_URL in Vercel project settings before submitting reports.');
      return;
    }
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (form.latitude === '' || form.longitude === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setStatus('Select a location on the map or use My location before submitting.');
      return;
    }
    if (form.description.trim().length < 5 || form.description.trim().length > 2000) {
      setStatus('Describe the issue in 5–2000 characters.');
      return;
    }
    if (!fileInputRef.current?.files?.[0]) {
      setStatus('Please attach or capture a photo before submitting.');
      return;
    }

    const file = fileInputRef.current.files[0];
    const formData = new FormData();
    formData.append('image', file);
    formData.append('defect_type', form.defect_type);
    formData.append('latitude', form.latitude);
    formData.append('longitude', form.longitude);
    formData.append('description', form.description.trim());
    formData.append('landmark', form.landmark.trim());
    formData.append('status', 'Pending');

    setSubmitting(true);
    setStatus('Submitting issue to AI triage engine...');

    try {
      let savedSession = null;
      try { savedSession = JSON.parse(localStorage.getItem('civicpulse_session') || 'null'); } catch { savedSession = null; }
      const response = await fetch(`${apiBase}/api/tickets/report`, {
        method: 'POST',
        headers: savedSession?.access_token ? { Authorization: `Bearer ${savedSession.access_token}` } : {},
        body: formData,
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || 'Submission failed.');
      }

      setStatus(result?.message || 'Ticket submitted successfully.');
      setTimeout(() => {
        window.location.href = '/command-center';
      }, 900);
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Report could not be submitted. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="report-shell">
      <header className="report-topbar">
        <Link to="/" className="brand-wrap brand-link">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <span className="brand-name">CivicPulse • AI</span>
        </Link>

        <nav className="report-nav" aria-label="Report navigation">
          <NavLink to="/report" className="nav-pill active">
            <Camera size={15} />
            Citizen Report
          </NavLink>
          <NavLink to="/command-center" className="nav-pill">
            <MapPinned size={15} />
            Command Center
          </NavLink>
          <span className="live-pill">
            <span className="live-dot" />
            LIVE
          </span>
        </nav>
      </header>

      <main className="report-main">
        <div className="report-heading-wrap">
          <h1>Report a civic issue</h1>
          <p>Photo — AI triage — geo-verified ticket. Your report joins the live dispatch wire.</p>
        </div>

        <form onSubmit={submitReport} className="report-grid report-form">
          <section className="report-panel capture-panel">
            <div className="panel-header">
              <span className="panel-number">1</span>
              <h2>Capture the issue</h2>
            </div>

            <div className="upload-area">
              <div className="upload-grid" />
              <div className="camera-preview">
                {preview ? (
                  <img src={preview} alt="Issue preview" className="preview-image" />
                ) : (
                  <>
                    <div className="camera-frame">
                      <Camera size={18} />
                    </div>
                    <span>Camera preview appears here</span>
                  </>
                )}
              </div>
            </div>

            <div className="capture-actions">
              <button type="button" className="blue-btn" onClick={() => fileInputRef.current?.click()}>
                <Camera size={18} />
                Open Camera
              </button>
              <button type="button" className="outline-btn" onClick={() => fileInputRef.current?.click()}>
                <Upload size={18} />
                Upload
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden-input"
              onChange={handleFileChange}
            />

            <button type="button" className="analysis-btn" onClick={() => setStatus(preview ? "AI analysis runs when you submit the report." : "Capture or upload an image before AI analysis.")}>
              <Sparkles size={18} />
              AI analysis on submit
            </button>
          </section>

          <section className="report-panel map-panel">
            <div className="panel-header">
              <span className="panel-number">2</span>
              <h2>Pin the location &amp; dispatch details</h2>
            </div>

            <form className="location-search" onSubmit={searchLocation}>
              <label className="field-label" htmlFor="location-search-input">
                <span>Search an address or landmark</span>
                <div className="location-search-row">
                  <input id="location-search-input" type="search" value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="e.g. ABES Engineering College, Ghaziabad" maxLength={180} autoComplete="street-address" />
                  <button type="submit" className="blue-btn" disabled={searchingLocation}>{searchingLocation ? 'Searching...' : 'Search'}</button>
                </div>
              </label>
              {locationResults.length > 0 && (
                <div className="location-results" role="listbox" aria-label="Address search results">
                  {locationResults.map((result) => (
                    <button type="button" role="option" aria-selected="false" className="location-result" key={result.place_id} onClick={() => chooseSearchResult(result)}>
                      <MapPinned size={15} /><span>{result.display_name}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="location-search-note">Search is powered by OpenStreetMap. You can also tap the map to place the pin precisely.</p>
            </form>

            <div className="map-box">
              <LocationPickerMap latitude={form.latitude} longitude={form.longitude} onLocationChange={selectMapLocation} />
              <button type="button" className="location-chip" onClick={useCurrentLocation}>
                <LocateFixed size={14} /> My location
              </button>
              <div className="map-selection-hint">
                {form.latitude && form.longitude ? `Pinned: ${form.latitude}, ${form.longitude}` : 'Tap the map to drop a pin, or use My location'}
              </div>
            </div>

            <label className="field-label small-label">
              <span>Nearest landmark / address (optional)</span>
              <input type="text" maxLength={200} value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} placeholder="Street, landmark, or nearby building" />
            </label>

            <label className="field-label">
              <span>Describe the issue — what’s wrong, since when, how bad...</span>
              <textarea
                rows="3"
                minLength={5}
                maxLength={2000}
                required
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>

            <label className="field-label">
              <span>Issue type</span>
              <div className="selector-box">
                <select value={form.defect_type} onChange={(e) => setForm({ ...form, defect_type: e.target.value })}>
                  <option value="pothole">Pothole</option>
                  <option value="garbage">Garbage</option>
                  <option value="streetlight">Streetlight damage</option>
                  <option value="sewage">Sewage spill</option>
                </select>
                <ChevronDown size={16} />
              </div>
            </label>

            <div className="lat-long-row">
              <label className="mini-field">
                <span>Latitude</span>
                <input type="number" step="any" min="-90" max="90" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
              </label>
              <label className="mini-field">
                <span>Longitude</span>
                <input type="number" step="any" min="-180" max="180" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
              </label>
            </div>

            <div className="submit-row">
              <button type="button" className="mini-action" onClick={() => {
                document.querySelector('.map-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setStatus('Adjust the pin on the map or search for another address.');
              }}>
                <MapPinned size={15} />
                Edit location
              </button>
              <button type="submit" className="submit-btn" disabled={submitting}>
                <Send size={16} />
                {submitting ? 'Submitting...' : 'Submit report'}
              </button>
            </div>

            {status && <p className="status-line" role="status" aria-live="polite">{status}</p>}

            <div className="submit-spacer" aria-hidden="true" />
          </section>
        </form>
      </main>

      <button
        type="button"
        className="floating-cta"
        aria-label="Submit report"
        onClick={() => { const reportForm = document.querySelector('.report-form'); if (reportForm?.requestSubmit) reportForm.requestSubmit(); else document.querySelector('.submit-btn')?.click(); }}
      >
        <Send size={18} />
      </button>
    </div>
  );
}

function CommandCenterPage() {
  const [tickets, setTickets] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [activeFilter, setActiveFilter] = useState('All statuses');
  const [activeDefectFilter, setActiveDefectFilter] = useState('All defects');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState('signin');
  const [authSession, setAuthSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem('civicpulse_session') || 'null'); } catch { return null; }
  });
  const [profileRole, setProfileRole] = useState('resident');
  const [authMessage, setAuthMessage] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTickets = async () => {
      try {
        const response = await fetch(`${apiBase}/api/tickets`);
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || 'Unable to load tickets.');
        if (Array.isArray(data)) {
          setTickets(data);
          setLoadError('');
        } else throw new Error('Unexpected ticket response from server.');
      } catch (error) {
        console.warn('Ticket loading failed', error);
        setLoadError(error.message || 'Unable to load tickets.');
      } finally {
        setLoading(false);
      }
    };

    loadTickets();
    const refresh = window.setInterval(loadTickets, 10000);
    return () => window.clearInterval(refresh);
  }, []);

  useEffect(() => {
    if (!authSession?.access_token) { setProfileRole('resident'); return; }
    let cancelled = false;
    fetch(`${apiBase}/api/me`, { headers: { Authorization: `Bearer ${authSession.access_token}` } })
      .then((response) => response.json())
      .then((profile) => { if (!cancelled) setProfileRole(profile.role || 'resident'); })
      .catch(() => { if (!cancelled) setProfileRole('resident'); });
    return () => { cancelled = true; };
  }, [authSession]);

  const authenticate = async (event) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthMessage('');
    try {
      const signup = authMode === 'signup';
      const endpoint = signup ? `${SUPABASE_URL}/auth/v1/signup` : `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail.trim(), password: authPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.msg || result.message || result.error_description || 'Authentication failed.');
      if (result.access_token) {
        localStorage.setItem('civicpulse_session', JSON.stringify(result));
        setAuthSession(result);
        setAuthMessage('Signed in. Your database role is ' + (result.user?.role || 'resident') + '; staff actions require the staff/admin profile role.');
      } else {
        setAuthMessage('Account created. If email confirmation is enabled, confirm your email and then sign in.');
        setAuthMode('signin');
      }
    } catch (error) {
      setAuthMessage(error.message || 'Could not authenticate.');
    } finally { setAuthBusy(false); }
  };

  const signOut = () => {
    localStorage.removeItem('civicpulse_session');
    setAuthSession(null);
    setProfileRole('resident');
    setAuthMessage('Signed out.');
  };

  const resolveTicket = async (ticketId, file) => {
    if (!file) return;
    if (!authSession?.access_token) { setAuthMessage('Sign in with an authorized staff account before submitting repair evidence.'); return; }
    const formData = new FormData();
    formData.append('image', file);
    try {
      const response = await fetch(`${apiBase}/api/tickets/${ticketId}/resolve`, {
        method: 'POST', headers: { Authorization: `Bearer ${authSession.access_token}` }, body: formData,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Resolution evidence upload failed.');
      if (result.ticket) setTickets((current) => current.map((ticket) => (ticket._id || ticket.id) === ticketId ? { ...ticket, ...result.ticket } : ticket));
      setAuthMessage(result.verified ? 'Repair verified and ticket resolved.' : 'Evidence saved. The ticket stays open until AI verification is available and passes.');
    } catch (error) { setAuthMessage(error.message || 'Resolution evidence upload failed.'); }
  };

  const visibleTickets = useMemo(() => tickets.filter((ticket) =>
    (activeFilter === 'All statuses' || ticket.status === activeFilter) &&
    (activeDefectFilter === 'All defects' || ticket.defect_type === activeDefectFilter)
  ), [tickets, activeFilter, activeDefectFilter]);

  const dispatchQueue = useMemo(() => {
    const queue = {
      Pending: [],
      Assigned: [],
      'In Progress': [],
      Resolved: [],
    };

    visibleTickets.forEach((ticket) => {
      if (queue[ticket.status]) {
        queue[ticket.status].push(ticket);
      }
    });

    return queue;
  }, [visibleTickets]);

  const updateStatus = async (ticketId, nextStatus) => {
    if (!apiBase) {
      window.alert('Backend API is not configured. Set VITE_API_BASE_URL before updating tickets.');
      return;
    }
    if (!authSession?.access_token) {
      setAuthMessage('Sign in with an authorized staff account to change ticket status.');
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession.access_token}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.message || 'Status update failed');
      setTickets((current) => current.map((ticket) => ((ticket._id || ticket.id) === ticketId ? { ...ticket, ...updated } : ticket)));
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Status update failed. Please try again.');
    }
  };

  const stats = [
    { label: 'Active incidents', value: tickets.length, icon: '△', tone: 'blue' },
    { label: 'Critical open', value: tickets.filter((t) => t.severity === 'CRITICAL').length, icon: '⏱', tone: 'red' },
    { label: 'In the field', value: tickets.filter((t) => t.status === 'Assigned' || t.status === 'In Progress').length, icon: '◔', tone: 'amber' },
    { label: 'Resolved rate', value: `${Math.round((tickets.filter((t) => t.status === 'Resolved').length / Math.max(tickets.length, 1)) * 100)}%`, icon: '◌', tone: 'green' },
  ];

  const statusOrder = ['Pending', 'Assigned', 'In Progress', 'Resolved'];

  return (
    <div className="command-shell">
      <header className="topbar">
        <Link to="/" className="brand-wrap brand-link">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <span className="brand-name">CivicPulse AI</span>
        </Link>

        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/report" className="nav-link">
            <Camera size={15} />
            Citizen Report
          </NavLink>
          <NavLink to="/command-center" className="nav-link active">
            <MapPinned size={15} />
            Command Center
          </NavLink>
          <span className="live-pill">
            <span className="live-dot" />
            LIVE
          </span>
        </nav>
      </header>

      <main className="command-main">
        <div className="command-header">
          <div>
            <h1>Authority Command Center</h1>
            <p>Live city signals, dispatch board and AI resolution verification.</p>
          </div>

          <div className="command-filter-row">
            <label className="select-box" aria-label="Filter by status">
              <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}>
                <option>All statuses</option><option>Pending</option><option>Assigned</option><option>In Progress</option><option>Resolved</option>
              </select>
            </label>
            <label className="select-box" aria-label="Filter by defect">
              <select value={activeDefectFilter} onChange={(event) => setActiveDefectFilter(event.target.value)}>
                <option>All defects</option><option value="pothole">Pothole</option><option value="garbage">Garbage</option><option value="sewage">Sewage</option><option value="streetlight">Streetlight</option><option value="unknown">Unknown</option>
              </select>
            </label>
            <div className="staff-token-label" style={{ minWidth: '260px', maxWidth: '360px' }}>
              {authSession?.access_token ? (
                <div style={{ display: 'grid', gap: '6px' }}>
                  <span>{authSession.user?.email || 'Signed in'} · role: <strong>{profileRole}</strong></span>
                  <button type="button" className="outline-btn" onClick={signOut}>Sign out</button>
                </div>
              ) : (
                <form onSubmit={authenticate} style={{ display: 'grid', gap: '6px' }}>
                  <span>{authMode === 'signin' ? 'Staff / resident sign in' : 'Create resident account'}</span>
                  <input className="staff-token-input" type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="Email address" required autoComplete="email" />
                  <input className="staff-token-input" type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Password (min 6 characters)" required minLength={6} autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} />
                  <button type="submit" className="blue-btn" disabled={authBusy}>{authBusy ? 'Please wait...' : authMode === 'signin' ? 'Sign in' : 'Create account'}</button>
                  <button type="button" className="outline-btn" onClick={() => setAuthMode((mode) => mode === 'signin' ? 'signup' : 'signin')}>{authMode === 'signin' ? 'Create account' : 'Back to sign in'}</button>
                </form>
              )}
            </div>
          </div>
        </div>

        {loadError && <div className="status-banner" role="alert">{loadError}</div>}
        {authMessage && <div className="status-banner" role="status" aria-live="polite">{authMessage}</div>}
        {!loading && !loadError && tickets.length === 0 && <div className="status-banner">No civic reports yet. Submit a report to populate the command center.</div>}
        <div className="stats-grid">
          {stats.map((stat) => (
            <div key={stat.label} className={`stat-card ${stat.tone}`}>
              <div className="stat-icon">{stat.icon}</div>
              <div className="stat-number">{stat.value}</div>
              <div className="stat-label">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="command-content-grid">
          <section className="map-panel command-map-panel">
            <div className="map-panel-inner">
              <div className="command-map-heading">LIVE INCIDENT MAP</div>
              <TicketMap tickets={visibleTickets} />
              <div className="map-legend">
                <span className="legend-chip critical">CRITICAL</span>
                <span className="legend-chip medium">MEDIUM</span>
                <span className="legend-chip low">LOW</span>
                <span className="legend-chip resolved">RESOLVED</span>
              </div>
            </div>
          </section>

          <aside className="dispatch-rail">
            <div className="dispatch-header">
              <span>DISPATCH WIRE</span>
              <span className="streaming-pill">● STREAMING</span>
            </div>

            <div className="dispatch-list">
              {visibleTickets.slice(0, 6).map((ticket) => (
                <div key={ticket._id} className="dispatch-item">
                  <div className="dispatch-icon" aria-hidden="true">↳</div>
                  <div className="dispatch-text">
                    <div className="dispatch-row">
                      <span className="dispatch-title">{ticket.defect_type}</span>
                      <span className="dispatch-age">{formatRelativeTime(ticket.createdAt || ticket.created_at)}</span>
                    </div>
                    <div className="dispatch-meta">{ticket.zone || 'central'} Zone — Score {ticket.priority_score || 0} — {ticket.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <div className="taskboard-title">
          <span>DISPATCH BOARD — USE STATUS ACTIONS</span>
        </div>

        <div className="kanban-grid">
          {statusOrder.map((status) => (
            <div key={status} className="kanban-column">
              <div className="kanban-header">
                <span>{status}</span>
                <span className="column-count">{dispatchQueue[status].length}</span>
              </div>
              <div className="kanban-subtitle">
                {status === 'Pending' && 'Awaiting dispatch'}
                {status === 'Assigned' && 'Worker assigned'}
                {status === 'In Progress' && 'Crew on site'}
                {status === 'Resolved' && 'Closed & verified'}
              </div>

              <div className="kanban-cards">
                {(dispatchQueue[status] || []).map((ticket) => (
                  <div key={ticket._id} className="kanban-card">
                    <div className="card-header-line">
                      <span className="card-id">{String(ticket._id || ticket.id || 'N/A').slice(-5)}</span>
                      <span className={`card-severity ${String(ticket.severity || 'MEDIUM').toLowerCase()}`}>
                        {ticket.severity || 'MEDIUM'}
                      </span>
                    </div>
                    <div className="card-title">{ticket.defect_type}</div>
                    <div className="card-location">{ticket.zone || 'central'} Zone</div>
                    <div className="card-footer">
                      <span>Priority {ticket.priority_score ?? 0}</span>
                      <span>Reports {ticket.report_frequency ?? 1}</span>
                    </div>
                    {status === 'Pending' && <button type="button" className="card-action" onClick={() => updateStatus(ticket._id || ticket.id, 'Assigned')}>Assign ticket →</button>}
                    {status === 'Assigned' && <button type="button" className="card-action" onClick={() => updateStatus(ticket._id || ticket.id, 'In Progress')}>Start work →</button>}
                    {status === 'In Progress' && (
                      <label className="card-action" style={{ display: 'block', cursor: 'pointer' }}>
                        <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0]; if (file) resolveTicket(ticket._id || ticket.id, file); event.target.value = ''; }} />
                        Upload after-repair photo →
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
