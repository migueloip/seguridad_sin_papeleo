import { cn } from "@/lib/utils"

/**
 * Easysecure brand mark — amber rounded square with the dark shield/check.
 * Matches design-reference/desktop.markup.html (login + sidebar + AI drawer).
 */
export function BrandMark({
  size = 34,
  className,
}: {
  size?: number
  className?: string
}) {
  const icon = Math.round(size * 0.56)
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-[26%] bg-brand", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none">
        <path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4Z" fill="#16130e" />
        <path
          d="m8.5 12 2.5 2.5L16 9"
          stroke="#f3a40a"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
