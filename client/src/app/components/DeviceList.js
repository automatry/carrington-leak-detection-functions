// components/DeviceList.js
"use client";

import { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore'; // Import orderBy
import { db } from '@/lib/firebaseClient';
import DeviceCard from './DeviceCard';
import LoadingSpinner from './LoadingSpinner';
import styles from './DeviceList.module.css';

export default function DeviceList() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('identity.APARTMENT'); // Default sort
  const [filterProject, setFilterProject] = useState('all');
  // Add more filters as needed (e.g., status, commissioned)

  // Fetch and listen to devices
  useEffect(() => {
    setLoading(true);
    setError(null);

    // Basic query, ordered by default sort field initially
    // Note: Complex ordering/filtering might require composite indexes in Firestore
    let q = query(collection(db, 'devices'));
     // Apply Firestore level ordering if possible and simple
     try {
        if (sortBy === 'state.lastUpdate') {
            q = query(collection(db, 'devices'), orderBy('state.lastUpdate', 'desc'));
        } else if (sortBy === 'identity.APARTMENT') {
             q = query(collection(db, 'devices'), orderBy('identity.APARTMENT'));
        } // Add more Firestore supported orderings if needed
     } catch(indexError) {
         console.warn("Firestore index likely required for sorting by:", sortBy, indexError.message);
         // Fallback to basic query if index is missing
         q = query(collection(db, 'devices'));
     }


    const unsubscribe = onSnapshot(q, (snapshot) => {
      const deviceData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() // Spread all data into the object
      }));
      setDevices(deviceData);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching devices:", err);
      setError("Failed to load devices. Please try again later.");
      setLoading(false);
    });

    // Cleanup listener on unmount
    return () => unsubscribe();
  }, [sortBy]); // Re-run query if sortBy changes (for Firestore ordering)

  // Client-side filtering and further sorting
  const filteredAndSortedDevices = useMemo(() => {
    let result = devices;

    // Filter by Search Term (Apartment, ID, Project)
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(dev =>
        (dev.identity?.APARTMENT?.toLowerCase() || '').includes(lowerSearch) ||
        dev.id.toLowerCase().includes(lowerSearch) ||
        (dev.identity?.PROJECT?.toLowerCase() || '').includes(lowerSearch)
      );
    }

    // Filter by Project
    if (filterProject !== 'all') {
       result = result.filter(dev => (dev.identity?.PROJECT || 'Unassigned') === filterProject);
    }

     // Add more client-side filters here (status, commissioned)

    // Client-side sorting (if Firestore ordering wasn't sufficient or for complex fields)
    // Example: Sort by commissioned status then apartment
    // result.sort((a, b) => {
    //    const commA = a.identity?.commissioned ?? false;
    //    const commB = b.identity?.commissioned ?? false;
    //    if(commA !== commB) return commB - commA; // True (commissioned) first
    //    return (a.identity?.APARTMENT || '').localeCompare(b.identity?.APARTMENT || '');
    // });

    return result;
  }, [devices, searchTerm, filterProject, /* include other filter states */ sortBy]);

  // Get unique project names for filter dropdown
  const projects = useMemo(() => {
     const projectSet = new Set(devices.map(d => d.identity?.PROJECT || 'Unassigned'));
     return ['all', ...Array.from(projectSet).sort()];
  }, [devices]);


  if (loading) return <LoadingSpinner fullPage={false} />;
  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <div className={styles.deviceListContainer}>
      {/* Filter and Sort Controls */}
      <div className={styles.controls}>
        <input
          type="text"
          placeholder="Search by Apartment, ID, Project..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={styles.searchInput}
        />
         <select
             value={filterProject}
             onChange={(e) => setFilterProject(e.target.value)}
             className={styles.selectInput}
         >
             {projects.map(proj => <option key={proj} value={proj}>{proj === 'all' ? 'All Projects' : proj}</option>)}
         </select>
        {/* Add Sort Select */}
        {/* <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className={styles.selectInput}
        >
            <option value="identity.APARTMENT">Sort by Apartment</option>
            <option value="state.lastUpdate">Sort by Last Update</option>
            {/* Add more sort options * / }
        </select> */}
      </div>

      {/* Device Grid */}
      {filteredAndSortedDevices.length === 0 ? (
        <p>No devices found matching your criteria.</p>
      ) : (
        <div className={styles.grid}>
          {filteredAndSortedDevices.map(device => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </div>
      )}
    </div>
  );
}