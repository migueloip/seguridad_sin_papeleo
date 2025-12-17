import { createRoot } from "react-dom/client"
import { act } from "react"
import { AnimatedPage } from "./animated-page"

describe("AnimatedPage", () => {
  it("applies duration to transition style", () => {
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
    expect(el.style.transition).toContain("transform 300ms ease")
    root.unmount()
    document.body.removeChild(container)
  })

  it("transitions from hidden to visible by toggling classes", () => {
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
    expect(el.className).toContain("translate-y-2")
    act(() => {
      vi.advanceTimersByTime(20)
    })
    expect(el.className).toContain("opacity-100")
    expect(el.className).toContain("translate-y-0")
    root.unmount()
    document.body.removeChild(container)
    vi.useRealTimers()
  })
})
