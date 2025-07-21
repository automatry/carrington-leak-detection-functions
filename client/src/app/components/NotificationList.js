// client/src/app/components/NotificationList.js
"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';
import LoadingSpinner from './LoadingSpinner';
import styles from './NotificationList.module.css';

const NOTIFICATIONS_LIMIT = 500; // Increased limit for better client-side filtering

export default function NotificationList() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // --- State for Advanced Filtering, Sorting, and Searching ---
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedApartments, setSelectedApartments] = useState([]);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [sortConfig, setSortConfig] = useState({ key: 'triggeredAt', direction: 'desc' });

  // --- State for custom multi-select dropdowns ---
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [isApartmentDropdownOpen, setIsApartmentDropdownOpen] = useState(false);
  const [apartmentSearch, setApartmentSearch] = useState('');
  
  const typeDropdownRef = useRef(null);
  const apartmentDropdownRef = useRef(null);

  // --- Fetch Notifications ---
  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, 'notifications'),
      orderBy('triggeredAt', 'desc'),
      limit(NOTIFICATIONS_LIMIT)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notifData = snapshot.docs.map(doc => {
        const data = doc.data();
        // Ensure timestamp is a JS Date object for easier sorting/filtering
        const triggeredAt = data.triggeredAt?.toDate ? data.triggeredAt.toDate() : null;
        return {
          id: doc.id,
          ...data,
          triggeredAt,
        };
      });
      setNotifications(notifData);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching notifications:", err);
      setError("Failed to load notifications.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // --- Click outside handler for dropdowns ---
  useEffect(() => {
    function handleClickOutside(event) {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(event.target)) {
        setIsTypeDropdownOpen(false);
      }
      if (apartmentDropdownRef.current && !apartmentDropdownRef.current.contains(event.target)) {
        setIsApartmentDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);


  // --- Derived data for filters ---
  const uniqueApartments = useMemo(() => {
    const apartmentSet = new Set(notifications.map(n => n.apartment).filter(Boolean));
    return Array.from(apartmentSet).sort();
  }, [notifications]);

  const uniqueTypes = useMemo(() => {
    const typeSet = new Set(notifications.map(n => n.type).filter(Boolean));
    return Array.from(typeSet).sort();
  }, [notifications]);


  // --- Combined Filtering and Sorting Logic ---
  const filteredAndSortedNotifications = useMemo(() => {
    let filtered = [...notifications];

    // 1. Filter by Date Range
    if (dateRange.from) {
      const fromDate = new Date(dateRange.from);
      fromDate.setHours(0, 0, 0, 0);
      filtered = filtered.filter(n => n.triggeredAt && n.triggeredAt >= fromDate);
    }
    if (dateRange.to) {
      const toDate = new Date(dateRange.to);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(n => n.triggeredAt && n.triggeredAt <= toDate);
    }

    // 2. Filter by Selected Apartments
    if (selectedApartments.length > 0) {
      const apartmentSet = new Set(selectedApartments);
      filtered = filtered.filter(n => apartmentSet.has(n.apartment));
    }

    // 3. Filter by Selected Types
    if (selectedTypes.length > 0) {
      const typeSet = new Set(selectedTypes);
      filtered = filtered.filter(n => typeSet.has(n.type));
    }
    
    // 4. Filter by General Search Term
    if (searchTerm) {
        const lowercasedTerm = searchTerm.toLowerCase();
        filtered = filtered.filter(n =>
            (n.message && n.message.toLowerCase().includes(lowercasedTerm)) ||
            (n.apartment && n.apartment.toLowerCase().includes(lowercasedTerm)) ||
            (n.type && n.type.toLowerCase().includes(lowercasedTerm))
        );
    }

    // 5. Apply Sorting
    if (sortConfig.key) {
      filtered.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];

        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        
        let comparison = 0;
        if (aVal > bVal) {
          comparison = 1;
        } else if (aVal < bVal) {
          comparison = -1;
        }

        return sortConfig.direction === 'asc' ? comparison : -comparison;
      });
    }

    return filtered;
  }, [notifications, dateRange, selectedApartments, selectedTypes, searchTerm, sortConfig]);

  // --- Handlers for UI controls ---
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const toggleSelection = (item, selectedItems, setter) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(item)) {
      newSelection.delete(item);
    } else {
      newSelection.add(item);
    }
    setter(Array.from(newSelection));
  };

  const filteredApartmentOptions = useMemo(() => {
    const lowerSearch = apartmentSearch.toLowerCase();
    return uniqueApartments.filter(apt => 
        !selectedApartments.includes(apt) && apt.toLowerCase().includes(lowerSearch)
    );
  }, [apartmentSearch, uniqueApartments, selectedApartments]);


  if (loading) return <LoadingSpinner size="large" />;
  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <div className={styles.listContainer}>
      <div className={styles.controlsContainer}>
        <div className={styles.filterGroup}>
          <label>Search</label>
          <input
            type="text"
            placeholder="Search all fields..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <div className={styles.filterGroup} ref={apartmentDropdownRef}>
          <label>Apartment</label>
          <div className={styles.multiSelect} onClick={() => setIsApartmentDropdownOpen(true)}>
            {selectedApartments.length > 0 ? (
                selectedApartments.map(apt => (
                    <span key={apt} className={styles.selectedItemBadge} onClick={(e) => { e.stopPropagation(); toggleSelection(apt, selectedApartments, setSelectedApartments); }}>
                        {apt} ×
                    </span>
                ))
            ) : <span className={styles.placeholder}>Any</span>}
          </div>
           {isApartmentDropdownOpen && (
                <div className={styles.dropdown}>
                    <input
                        type="text"
                        placeholder="Search apartments..."
                        className={styles.dropdownSearch}
                        value={apartmentSearch}
                        onChange={(e) => setApartmentSearch(e.target.value)}
                        autoFocus
                    />
                    <ul className={styles.dropdownList}>
                       {filteredApartmentOptions.map(apt => (
                            <li key={apt} onClick={() => { toggleSelection(apt, selectedApartments, setSelectedApartments); setApartmentSearch(''); }}>
                                {apt}
                            </li>
                       ))}
                       {filteredApartmentOptions.length === 0 && <li className={styles.noResults}>No matches</li>}
                    </ul>
                </div>
            )}
        </div>

        <div className={styles.filterGroup} ref={typeDropdownRef}>
            <label>Type</label>
            <div className={styles.multiSelect} onClick={() => setIsTypeDropdownOpen(prev => !prev)}>
                {selectedTypes.length > 0 ? (
                    selectedTypes.map(type => (
                        <span key={type} className={styles.selectedItemBadge} onClick={(e) => { e.stopPropagation(); toggleSelection(type, selectedTypes, setSelectedTypes); }}>
                            {type} ×
                        </span>
                    ))
                ) : <span className={styles.placeholder}>All Types</span>}
            </div>
            {isTypeDropdownOpen && (
                <div className={styles.dropdown}>
                     <ul className={styles.dropdownList}>
                        {uniqueTypes.map(type => (
                            <li key={type} onClick={() => toggleSelection(type, selectedTypes, setSelectedTypes)}>
                                <input type="checkbox" checked={selectedTypes.includes(type)} readOnly />
                                {type}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>

        <div className={styles.filterGroup}>
          <label>Date From</label>
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange(p => ({...p, from: e.target.value}))}
            className={styles.dateInput}
          />
        </div>

        <div className={styles.filterGroup}>
          <label>Date To</label>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange(p => ({...p, to: e.target.value}))}
            className={styles.dateInput}
          />
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.sortableHeader} onClick={() => handleSort('triggeredAt')}>
                Timestamp {sortConfig.key === 'triggeredAt' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className={styles.sortableHeader} onClick={() => handleSort('type')}>
                Type {sortConfig.key === 'type' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className={styles.sortableHeader} onClick={() => handleSort('apartment')}>
                Apartment {sortConfig.key === 'apartment' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedNotifications.length > 0 ? (
              filteredAndSortedNotifications.map(notif => (
                <tr key={notif.id}>
                  <td className={styles.timestampCell}>{notif.triggeredAt ? notif.triggeredAt.toLocaleString() : 'N/A'}</td>
                  <td>
                    <span className={`${styles.typeBadge} ${styles['type-' + (notif.type || 'unknown')]}`}>
                      {notif.type || 'unknown'}
                    </span>
                  </td>
                  <td>{notif.apartment || 'N/A'}</td>
                  <td className={styles.messageCell}>{notif.message || 'No message'}</td>
                </tr>
              ))
            ) : (
                <tr>
                    <td colSpan="4" className={styles.noResults}>No notifications found matching your criteria.</td>
                </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}