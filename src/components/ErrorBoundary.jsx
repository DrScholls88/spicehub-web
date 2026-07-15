import { Component } from 'react';

// Top-level safety net. Before this existed, ANY uncaught render exception
// anywhere in the tree (e.g. the 2026-07-14 "Meal Library goes blank" bug —
// rendering a structured notes[] array as a raw JSX child) unmounted the
// entire app with no recovery path except manually deleting the offending
// data from another device/browser. This never fixes the underlying bug —
// it just guarantees a crash is recoverable in-app instead of a dead white
// screen, which matters most on iOS PWAs where there's no dev console handy.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] caught render error:', error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: '32px 24px',
            textAlign: 'center',
            background: 'var(--bg, #14181f)',
            color: 'var(--text, #f2f2f2)',
          }}
        >
          <div style={{ fontSize: 40 }}>🍽️💥</div>
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <p style={{ margin: 0, opacity: 0.75, maxWidth: 340 }}>
            SpiceHub hit an unexpected error rendering this screen. Your saved recipes and
            drinks are safe in local storage — reloading usually fixes it.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: '12px 24px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--primary, #e07b4f)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            Reload SpiceHub
          </button>
          {this.state.error?.message && (
            <pre
              style={{
                marginTop: 8,
                fontSize: 11,
                opacity: 0.5,
                maxWidth: 320,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {this.state.error.message}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
