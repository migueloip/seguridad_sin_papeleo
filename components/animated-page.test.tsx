import { createRoot } from "react-dom/client"
import { act } from "react"
import { AnimatedPage } from "./animated-page"

describe("AnimatedPage", () => {
  it("applies duration to transition style, animating ONLY opacity", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <AnimatedPage duration={300}>
          <div>content</div>
        </AnimatedPage>,
      )
    })
    const el = container.firstElementChild as HTMLElement
    expect(el.style.transition).toContain("opacity 300ms ease")
    // Animar transform crearía un containing block que rompe el position:fixed
    // de cajones y modales — no debe volver a aparecer.
    expect(el.style.transition).not.toContain("transform")
    root.unmount()
    document.body.removeChild(container)
  })

  it("transitions from hidden to visible by toggling opacity classes", () => {
    vi.useFakeTimers()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <AnimatedPage duration={400}>
          <div>content</div>
        </AnimatedPage>,
      )
    })
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toContain("opacity-0")
    expect(el.className).not.toContain("translate-y")
    act(() => {
      vi.advanceTimersByTime(20)
    })
    expect(el.className).toContain("opacity-100")
    root.unmount()
    document.body.removeChild(container)
    vi.useRealTimers()
  })
})
