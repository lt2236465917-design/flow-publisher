import { type ReactNode, useRef, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

interface PageTransitionProps {
  children: ReactNode
}

export default function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation()
  const [displayChildren, setDisplayChildren] = useState(children)
  const [transitioning, setTransitioning] = useState(false)
  const prevPathRef = useRef(location.pathname)

  useEffect(() => {
    if (location.pathname !== prevPathRef.current) {
      prevPathRef.current = location.pathname
      setTransitioning(true)

      const timer = setTimeout(() => {
        setDisplayChildren(children)
        setTransitioning(false)
      }, 150)

      return () => clearTimeout(timer)
    } else {
      setDisplayChildren(children)
    }
  }, [children, location.pathname])

  return (
    <div
      style={{
        opacity: transitioning ? 0 : 1,
        transform: transitioning ? 'translateY(8px)' : 'translateY(0)',
        transition: 'opacity 0.15s ease, transform 0.15s ease'
      }}
    >
      {displayChildren}
    </div>
  )
}
