/**
 * Skip to Content Link
 * Accessibility feature for keyboard navigation
 * Appears on focus (Tab key) to allow users to skip navigation
 */
export default function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="
        sr-only
        focus:not-sr-only
        focus:absolute
        focus:top-4
        focus:left-4
        focus:z-50
        focus:px-4
        focus:py-2
        focus:bg-white/90
        focus:text-black
        focus:rounded
        focus:shadow-lg
        focus:outline-none
        focus:ring-2
        focus:ring-white/50
        focus:ring-offset-2
        focus:ring-offset-black/50
      "
    >
      Skip to main content
    </a>
  );
}
