// components/NotificationList.js
"use client";

import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient'; // Adjust path
import LoadingSpinner from './LoadingSpinner';
import styles from './NotificationList.module.css';

const NOTIFICATIONS_LIMIT = 50; // Limit initial load

export default function NotificationList() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterType, setFilterType] = useState('all');
  // Add more filters if needed (e.g., date range, apartment)

  useEffect(() => {
    setLoading(true);
    setError(null);

    const q = query(
      collection(db, 'notifications'),
      orderBy('triggeredAt', 'desc'), // Most recent first
      limit(NOTIFICATIONS_LIMIT) // Limit initial query
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notifData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setNotifications(notifData);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching notifications:", err);
      setError("Failed to load notifications.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []); // Run only once on mount

  const filteredNotifications = useMemo(() => {
    let result = notifications;
    if (filterType !== 'all') {
      result = result.filter(n => n.type === filterType);
    }
    // Add more client-side filtering here
    return result;
  }, [notifications, filterType]);

  // Get unique notification types for filter dropdown
  const notificationTypes = useMemo(() => {
     const typeSet = new Set(notifications.map(n => n.type));
     return ['all', ...Array.from(typeSet).sort()];
  }, [notifications]);


  if (loading) return <LoadingSpinner fullPage={false} />;
  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <div className={styles.listContainer}>
      {/* Filter Controls */}
       <div className={styles.controls}>
           <select
               value={filterType}
               onChange={(e) => setFilterType(e.target.value)}
               className={styles.selectInput}
           >
               {notificationTypes.map(type => (
                   <option key={type} value={type}>
                       {type === 'all' ? 'All Types' : type}
                   </option>
               ))}
           </select>
           {/* Add more filters */}
       </div>

      {/* Notification Table/List */}
      {filteredNotifications.length === 0 ? (
        <p>No notifications found.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Type</th>
              <th>Apartment</th>
              <th>Message</th>
              {/* Add more columns if needed */}
            </tr>
          </thead>
          <tbody>
            {filteredNotifications.map(notif => (
              <tr key={notif.id}>
                <td>{notif.triggeredAt?.toDate ? notif.triggeredAt.toDate().toLocaleString() : 'N/A'}</td>
                <td><span className={`${styles.typeBadge} ${styles['type-' + (notif.type || 'unknown')]}`}>{notif.type || 'unknown'}</span></td>
                <td>{notif.apartment || 'N/A'}</td>
                <td>{notif.message || 'No message'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}