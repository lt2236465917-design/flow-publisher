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
      }, 200)

      return () => clearTimeout(timer)
    } else {
      setDisplayChildren(children)
    }
  }, [children, location.pathname])

  return (
    <div
      style={{
        opacity: transitioning ? 0 : 1,
        transform: transitioning ? 'translateY(12px)' : 'translateY(0)',
        transition: 'opacity 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      }}
    >
      {displayChildren}
    </div>
  )
}
