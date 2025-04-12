// components/LoadingSpinner.js
import styles from './LoadingSpinner.module.css';

export default function LoadingSpinner({ fullPage = true }) {
  return (
    <div className={fullPage ? styles.fullPageContainer : styles.inlineContainer}>
      <div className={styles.spinner}></div>
      <p>Loading...</p>
    </div>
  );
}