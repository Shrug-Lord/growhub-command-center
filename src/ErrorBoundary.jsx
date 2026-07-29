import React from 'react'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surface in console for quick debugging.
    console.error('App crashed:', error, info)
  }

  render() {
    const { error } = this.state
    const { children } = this.props
    if (!error) return children

    return (
      <div style={{ padding: '24px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px' }}>
          Growhub dashboard crashed
        </h1>
        <p style={{ marginBottom: '12px' }}>
          A runtime error occurred. Check the console for details, then refresh.
        </p>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            background: '#f8f8f8',
            padding: '12px',
            borderRadius: '8px',
          }}
        >
          {String(error?.message || error)}
        </pre>
      </div>
    )
  }
}

export default ErrorBoundary
