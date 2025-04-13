// components/LoadingSpinner.js
import styles from './LoadingSpinner.module.css';

/**
 * Simple CSS loading spinner.
 * @param {object} props
 * @param {'small' | 'medium' | 'large'} [props.size='medium'] - Size of the spinner.
 * @param {string} [props.className=''] - Optional additional class names for the spinner element.
 */
export default function LoadingSpinner({ size = 'medium', className = '' }) {
  // Determine the CSS class based on the size prop
  const sizeClass = styles[size] || styles.medium;

  return (
    // Render only the spinner element itself
    <div
        className={`${styles.spinner} ${sizeClass} ${className}`}
        role="status" // Accessibility: indicates element updates dynamically
        aria-live="polite" // Polite means screen readers announce changes when idle
    >
        {/* Visually hidden text for screen readers */}
        <span className={styles.visuallyHidden}>Loading...</span>
    </div>
  );
}