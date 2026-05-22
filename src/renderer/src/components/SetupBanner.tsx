import React from 'react'

interface SetupBannerProps {
  message: string | null
}

export function SetupBanner({ message }: SetupBannerProps): React.JSX.Element | null {
  if (message === null) return null
  return (
    <div className="setup-banner" role="alert">
      {message}
    </div>
  )
}
