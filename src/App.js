import React, { useState, useEffect, useMemo, useCallback } from 'react';

// Firebase Imports (v9 modular SDK)
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signOut, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, Timestamp, getDocs, writeBatch } from 'firebase/firestore';

// --- Helper Components ---

// A reusable modal for alerts or confirmation dialogs.
const Modal = ({ isOpen, onClose, onConfirm, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full text-center">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{title}</h3>
        <div className="text-gray-700 mb-6">{children}</div>
        <div className="flex justify-center gap-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-300 text-gray-800 rounded-lg shadow hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-500 text-white rounded-lg shadow hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};


// --- Main App Component ---
const App = () => {
  // Core Data State
  const [associateData, setAssociateData] = useState([]);

  // UI State
  const [selectedAssociate, setSelectedAssociate] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState('');
  const [showOnHoldList, setShowOnHoldList] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  // Firebase State
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // --- Mappings ---
  const levelMap = {
    1: 'Associate',
    2: 'Senior Associate',
    3: 'Manager',
    4: 'Senior Manager',
    5: 'Director',
    6: 'Senior Director',
    7: 'Executive Director',
    8: 'Bronze ED',
    9: 'Silver ED',
    10: 'Gold ED',
    11: 'Platinum ED'
  };

  const getLevelTitle = (level) => levelMap[level] || `Level ${level}`;

  // --- Effects ---

  // Effect 1: Initialize Firebase and handle authentication
  useEffect(() => {
    // This logic is for the Canvas environment. For production, use environment variables.
    const firebaseConfig = typeof __firebase_config !== 'undefined'
      ? JSON.parse(__firebase_config)
      : null;

    if (!firebaseConfig) {
      setError("Firebase configuration is missing. The app cannot be initialized.");
      setLoading(false);
      return;
    }

    try {
      const app = initializeApp(firebaseConfig);
      const authInstance = getAuth(app);
      const firestoreInstance = getFirestore(app);
      
      setDb(firestoreInstance);
      setAuth(authInstance);

      const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
        if (user) {
          setUserId(user.uid);
          setIsAuthReady(true);
        } else {
          const authToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
          try {
            if (authToken) {
              await signInWithCustomToken(authInstance, authToken);
            } else {
              await signInAnonymously(authInstance);
            }
          } catch (authError) {
            console.error("Firebase Authentication Error:", authError);
            setError("Authentication failed. Please refresh the page or check your connection.");
            setIsAuthReady(false);
            setLoading(false);
          }
        }
      });

      return () => unsubscribe();

    } catch (initError) {
      console.error("Firebase Initialization Error:", initError);
      setError("Failed to initialize the application. Please check the console for details.");
      setLoading(false);
    }
  }, []);

  // Effect 2: Fetch associate data from Firestore once authentication is ready.
  useEffect(() => {
    if (!db || !isAuthReady || !userId) {
      if(isAuthReady) setLoading(false);
      return;
    }
    
    setLoading(true);
    
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const snapshotsColRef = collection(db, `artifacts/${appId}/users/${userId}/snapshots`);
    const q = query(snapshotsColRef, orderBy("uploadDate", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allSnapshots = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (allSnapshots.length > 0) {
        const latestSnapshot = allSnapshots[0];
        if (latestSnapshot.data && Array.isArray(latestSnapshot.data)) {
          setAssociateData(latestSnapshot.data);
          const displayDate = latestSnapshot.uploadDate instanceof Timestamp
            ? new Date(latestSnapshot.uploadDate.toDate()).toLocaleString()
            : 'N/A';
          setFileName(`Loaded from DB: ${displayDate}`);
        } else {
          setAssociateData([]);
          setFileName('');
        }

      } else {
        setAssociateData([]);
        setFileName('');
      }
      setLoading(false);
      setError(null);
    }, (dbError) => {
      console.error("Firestore Snapshot Error:", dbError);
      setError(dbError.code === 'permission-denied' ? "Permission Denied." : "Error loading data.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db, isAuthReady, userId]);
  
  // --- Memoized Calculations ---

  const organizationalSummary = useMemo(() => {
    const depthZeroAssociate = associateData.find(assoc => assoc['Depth Level'] === 0);
    if (!depthZeroAssociate) return null;

    const prevPremiumContributors = associateData.filter(assoc => (assoc['Personal Premium PMTD'] || 0) > 0).length;
    const prevRecruitsContributors = associateData.filter(assoc => (assoc['Personal Recruits PMTD'] || 0) > 0).length;

    return {
      orgPremiumMTD: depthZeroAssociate['Org Premium MTD'] || 0,
      orgPremiumPMTD: depthZeroAssociate['Org Premium PMTD'] || 0,
      orgRecruitsMTD: depthZeroAssociate['Org Recruits MTD'] || 0,
      orgRecruitsPMTD: depthZeroAssociate['Org Recruits PMTD'] || 0,
      premiumContributorsPMTD: prevPremiumContributors,
      recruitsContributorsPMTD: prevRecruitsContributors,
    };
  }, [associateData]);

  const qualificationStatus = useMemo(() => {
    const sdThreshold = 700, sdLegLimit = 350, edThreshold = 1400, edLegLimit = 700;
    const depthZeroAssociate = associateData.find(assoc => assoc['Depth Level'] === 0);
    if (!depthZeroAssociate) return null;

    const depthOneAssociates = associateData.filter(assoc => assoc['Depth Level'] === 1);
    const personalPremiumMTD = depthZeroAssociate['Personal Premium MTD'] || 0;

    const result = {
      sd: { qualified: false, threshold: sdThreshold, totalCountablePremium: 0, needed: 0 },
      ed: { qualified: false, threshold: edThreshold, totalCountablePremium: 0, needed: 0 },
    };

    const effectiveSdLegPremium = depthOneAssociates.reduce((total, leg) => {
        const legPremium = leg['Org Premium MTD'] || 0;
        return total + Math.min(legPremium, sdLegLimit);
    }, 0);

    const effectiveEdLegPremium = depthOneAssociates.reduce((total, leg) => {
        const legPremium = leg['Org Premium MTD'] || 0;
        return total + Math.min(legPremium, edLegLimit);
    }, 0);
    
    result.sd.totalCountablePremium = effectiveSdLegPremium + personalPremiumMTD;
    result.ed.totalCountablePremium = effectiveEdLegPremium + personalPremiumMTD;
    result.sd.qualified = result.sd.totalCountablePremium >= sdThreshold;
    result.ed.qualified = result.ed.totalCountablePremium >= edThreshold;
    
    if (!result.sd.qualified) result.sd.needed = sdThreshold - result.sd.totalCountablePremium;
    if (!result.ed.qualified) result.ed.needed = edThreshold - result.ed.totalCountablePremium;

    return result;
  }, [associateData]);

  const filteredAssociates = useMemo(() => {
    if (!searchTerm) return associateData;
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    return associateData.filter(a =>
        (a.Name || '').toLowerCase().includes(lowerCaseSearchTerm) ||
        (a['Associate ID'] || '').toString().toLowerCase().includes(lowerCaseSearchTerm)
    );
  }, [associateData, searchTerm]);

  const statusSummary = useMemo(() => {
    const summary = { active: 0, notVested: 0, onHold: 0, onHoldList: [] };
    associateData.forEach(associate => {
      const status = (associate.Status || '').trim();
      if (status === '') summary.active++;
      else if (status === 'D') summary.notVested++;
      else if (status === 'H') {
        summary.onHold++;
        summary.onHoldList.push(associate);
      }
    });
    return summary;
  }, [associateData]);

  const currentMonthPremiumContributors = useMemo(() => {
    return associateData
      .filter(a => (a['Personal Premium MTD'] || 0) > 0)
      .sort((a, b) => (b['Personal Premium MTD'] || 0) - (a['Personal Premium MTD'] || 0));
  }, [associateData]);

  const currentMonthRecruitsContributors = useMemo(() => {
    return associateData
      .filter(a => (a['Personal Recruits MTD'] || 0) > 0)
      .sort((a, b) => (b['Personal Recruits MTD'] || 0) - (a['Personal Recruits MTD'] || 0));
  }, [associateData]);


  // --- Event Handlers ---

  const splitCsvLine = (line) => {
    const result = []; let currentField = ''; let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuote = !inQuote;
      else if (char === ',' && !inQuote) { result.push(currentField.trim()); currentField = ''; }
      else currentField += char;
    }
    result.push(currentField.trim());
    return result;
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file || !db || !userId) {
      setError("Cannot upload file. Not ready or not authenticated.");
      event.target.value = null;
      return;
    }

    setLoading(true); setError(null); setFileName(file.name); setSelectedAssociate(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const lines = e.target.result.split('\n').filter(line => line.trim() !== '');
        if (lines.length < 2) throw new Error("CSV must have a header and at least one data row.");
        
        const headers = splitCsvLine(lines[0]);
        const seenIds = new Set();
        const parsedData = lines.slice(1).map((line, i) => {
            const values = splitCsvLine(line);
            if (values.length !== headers.length) {
                console.warn(`Skipping malformed row ${i + 2}`); return null;
            }
            const row = {};
            headers.forEach((header, index) => {
                const value = values[index];
                if (header.includes('Premium') || header.includes('Recruits') || header.includes('Total') || header.includes('Level')) {
                    row[header] = parseFloat(value) || 0;
                } else if (header === 'Associate ID') {
                    let id = value;
                    if (!id || id === '0' || seenIds.has(id)) id = crypto.randomUUID();
                    seenIds.add(id);
                    row[header] = id;
                } else {
                    row[header] = value;
                }
            });
            return row;
        }).filter(Boolean);

        if (parsedData.length === 0) throw new Error("No valid data parsed from CSV.");

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const snapshotsColRef = collection(db, `artifacts/${appId}/users/${userId}/snapshots`);
        await addDoc(snapshotsColRef, {
          uploadDate: serverTimestamp(), data: parsedData, originalFileName: file.name,
        });
        
      } catch (err) {
        console.error("File processing/saving error:", err);
        setError(`Failed to process file. ${err.message || ''}`);
      } finally {
        setLoading(false);
        event.target.value = null;
      }
    };
    reader.onerror = () => { setError("Failed to read file."); setLoading(false); };
    reader.readAsText(file);
  };
  
  const handleSelectAssociate = useCallback((associate) => setSelectedAssociate(associate), []);

  const handleClearAllData = async () => {
    setIsConfirmModalOpen(false);
    if (!db || !userId || !auth) {
        setError("Cannot clear data. Application not ready.");
        return;
    }
    setLoading(true);
    setError(null);
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const snapshotsColRef = collection(db, `artifacts/${appId}/users/${userId}/snapshots`);
        const snapshot = await getDocs(snapshotsColRef);
        
        if (snapshot.empty) {
            setLoading(false);
            return;
        }

        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        setAssociateData([]);
        setSelectedAssociate(null);
        setFileName('');
        await signOut(auth);

    } catch (err) {
        console.error("Error clearing data:", err);
        setError("Failed to clear data. Please try again.");
        setLoading(false);
    }
  };


  // --- Render Logic ---

  if (loading && !isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center">
            <p className="text-xl text-gray-700">Initializing & Authenticating...</p>
            <div className="mt-4 w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 font-sans antialiased">
      <Modal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={handleClearAllData}
        title="Clear All Data?"
      >
        <p>This will permanently delete all uploaded snapshots for your user ID. This action cannot be undone.</p>
      </Modal>
      
      <div className="mx-auto p-2 sm:p-4 lg:p-6 max-w-screen-2xl">
        <header className="mb-6">
            <h1 className="text-3xl md:text-4xl font-bold text-center text-gray-800 mb-4">
              Sales Organization Dashboard
            </h1>
            <div className="text-center text-xs sm:text-sm text-gray-600 flex justify-center items-center gap-4">
              {userId && <span>User ID: <span className="font-semibold">{userId}</span></span>}
              {auth && (
                <button
                  onClick={() => setIsConfirmModalOpen(true)}
                  className="px-3 py-1.5 bg-red-500 text-white rounded-md shadow-sm hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
                >
                  Clear Data & Restart
                </button>
              )}
            </div>
        </header>

        <main>
            <section className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-4 rounded-lg shadow-md">
                  <h2 className="text-xl font-semibold text-gray-700 mb-3">Upload Sales Data</h2>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
                    disabled={!isAuthReady || loading}
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    Report to upload: <a href="https://legalshield.myvoffice.com/index.cfm?Fuseaction=evo_Modules.QueryReport&QryID=Counters&QueryType=Counters&tabsel=Personal_Active_Enrollments" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Premium & Recruiting Activity: Organization</a>
                  </p>
                  {fileName && <p className="mt-2 text-sm text-gray-600">Last Loaded: <span className="font-medium">{fileName}</span></p>}
                  {loading && <p className="mt-2 text-blue-500">Processing...</p>}
                  {error && <p className="mt-2 text-red-600 font-medium">{error}</p>}
                </div>
                
                <div className="bg-white p-4 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold text-gray-700 mb-3">Associate Status</h2>
                    <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                            <p className="text-green-600 font-bold text-3xl">{statusSummary.active}</p>
                            <p className="text-sm text-gray-500">Active</p>
                        </div>
                        <div>
                            <p className="text-orange-600 font-bold text-3xl">{statusSummary.notVested}</p>
                            <p className="text-sm text-gray-500">Not Vested (D)</p>
                        </div>
                        <div className="relative">
                            <p className="text-red-600 font-bold text-3xl cursor-pointer" onClick={() => setShowOnHoldList(!showOnHoldList)}>{statusSummary.onHold}</p>
                            <p className="text-sm text-gray-500">On Hold (H)</p>
                            {showOnHoldList && (
                                <div className="absolute z-10 bg-white border rounded-lg shadow-lg mt-2 w-48 text-left max-h-48 overflow-y-auto">
                                    {statusSummary.onHoldList.length > 0 ? statusSummary.onHoldList.map(a => (
                                        <div key={a['Associate ID']} className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer" onClick={() => { handleSelectAssociate(a); setShowOnHoldList(false); }}>
                                            {a.Name}
                                        </div>
                                    )) : <div className="px-3 py-2 text-sm text-gray-500">None</div>}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {organizationalSummary && qualificationStatus && (
                <section className="mb-6 bg-white p-4 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Organization & Qualification Summary</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-indigo-50 p-3 rounded-lg"><h3 className="text-sm font-medium text-indigo-700">Org Premium MTD</h3><p className="text-2xl font-bold text-indigo-900">${organizationalSummary.orgPremiumMTD.toFixed(2)}</p><p className="text-xs text-gray-600">vs PMTD: ${organizationalSummary.orgPremiumPMTD.toFixed(2)}</p></div>
                        <div className="bg-pink-50 p-3 rounded-lg"><h3 className="text-sm font-medium text-pink-700">Org Recruits MTD</h3><p className="text-2xl font-bold text-pink-900">{organizationalSummary.orgRecruitsMTD}</p><p className="text-xs text-gray-600">vs PMTD: {organizationalSummary.orgRecruitsPMTD}</p></div>
                        <div className={`p-3 rounded-lg ${qualificationStatus.sd.qualified ? 'bg-green-100' : 'bg-yellow-100'}`}><h3 className="text-sm font-medium text-gray-700">Senior Director (SD)</h3><p className={`text-lg font-bold ${qualificationStatus.sd.qualified ? 'text-green-800' : 'text-yellow-800'}`}>{qualificationStatus.sd.qualified ? 'QUALIFIED' : 'NOT QUALIFIED'}</p><p className="text-xs text-gray-600">${qualificationStatus.sd.totalCountablePremium.toFixed(2)} / ${qualificationStatus.sd.threshold.toFixed(2)}{!qualificationStatus.sd.qualified && <span className="text-red-600"> (Needs ${qualificationStatus.sd.needed.toFixed(2)})</span>}</p></div>
                        <div className={`p-3 rounded-lg ${qualificationStatus.ed.qualified ? 'bg-green-100' : 'bg-yellow-100'}`}><h3 className="text-sm font-medium text-gray-700">Executive Director (ED)</h3><p className={`text-lg font-bold ${qualificationStatus.ed.qualified ? 'text-green-800' : 'text-yellow-800'}`}>{qualificationStatus.ed.qualified ? 'QUALIFIED' : 'NOT QUALIFIED'}</p><p className="text-xs text-gray-600">${qualificationStatus.ed.totalCountablePremium.toFixed(2)} / ${qualificationStatus.ed.threshold.toFixed(2)}{!qualificationStatus.ed.qualified && <span className="text-red-600"> (Needs ${qualificationStatus.ed.needed.toFixed(2)})</span>}</p></div>
                    </div>
                </section>
            )}

            {associateData.length > 0 && organizationalSummary && (
              <section className="mb-6 bg-white p-4 rounded-lg shadow-md">
                <h2 className="text-xl font-semibold text-gray-700 mb-4">Monthly Contributor Snapshot</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-600 mb-3">Premium Contributors</h3>
                    <div className="flex items-center gap-4 mb-3">
                      <div className="text-center">
                        <div className="bg-blue-500 text-white rounded-lg w-16 h-16 flex items-center justify-center text-2xl font-bold">{currentMonthPremiumContributors.length}</div>
                        <p className="text-xs font-semibold text-gray-500 mt-1">MTD</p>
                      </div>
                      <div className="text-center">
                        <div className="bg-blue-200 text-blue-800 rounded-lg w-16 h-16 flex items-center justify-center text-2xl font-bold">{organizationalSummary.premiumContributorsPMTD}</div>
                        <p className="text-xs font-semibold text-gray-500 mt-1">PMTD</p>
                      </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto border rounded-lg p-2 bg-gray-50">
                      {currentMonthPremiumContributors.length > 0 ? (
                        currentMonthPremiumContributors.map(a => (
                          <div key={a['Associate ID']} onClick={() => handleSelectAssociate(a)} className="p-2 mb-1.5 rounded-md hover:bg-blue-100 cursor-pointer">
                            <p className="font-medium text-sm text-gray-800">{a.Name}</p>
                            <div className="flex justify-between text-xs text-gray-600">
                              <span>MTD: <span className="font-semibold text-green-600">${(a['Personal Premium MTD'] || 0).toFixed(2)}</span></span>
                              <span>PMTD: ${(a['Personal Premium PMTD'] || 0).toFixed(2)}</span>
                            </div>
                          </div>
                        ))
                      ) : <p className="text-center text-gray-500 py-4">None</p>}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-600 mb-3">Recruits Contributors</h3>
                    <div className="flex items-center gap-4 mb-3">
                      <div className="text-center">
                        <div className="bg-purple-500 text-white rounded-lg w-16 h-16 flex items-center justify-center text-2xl font-bold">{currentMonthRecruitsContributors.length}</div>
                        <p className="text-xs font-semibold text-gray-500 mt-1">MTD</p>
                      </div>
                      <div className="text-center">
                        <div className="bg-purple-200 text-purple-800 rounded-lg w-16 h-16 flex items-center justify-center text-2xl font-bold">{organizationalSummary.recruitsContributorsPMTD}</div>
                        <p className="text-xs font-semibold text-gray-500 mt-1">PMTD</p>
                      </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto border rounded-lg p-2 bg-gray-50">
                      {currentMonthRecruitsContributors.length > 0 ? (
                        currentMonthRecruitsContributors.map(a => (
                          <div key={a['Associate ID']} onClick={() => handleSelectAssociate(a)} className="p-2 mb-1.5 rounded-md hover:bg-purple-100 cursor-pointer">
                            <p className="font-medium text-sm text-gray-800">{a.Name}</p>
                            <div className="flex justify-between text-xs text-gray-600">
                              <span>MTD: <span className="font-semibold text-green-600">{a['Personal Recruits MTD'] || 0}</span></span>
                              <span>PMTD: {a['Personal Recruits PMTD'] || 0}</span>
                            </div>
                          </div>
                        ))
                      ) : <p className="text-center text-gray-500 py-4">None</p>}
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 bg-white p-4 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold text-gray-700 mb-3">Associates ({filteredAssociates.length})</h2>
                    <input
                      type="text"
                      placeholder="Search by name or ID..."
                      className="w-full p-2 border border-gray-300 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <div className="max-h-[60vh] overflow-y-auto pr-2">
                      {filteredAssociates.length > 0 ? (
                        filteredAssociates.map((associate) => (
                          <div
                            key={associate['Associate ID']}
                            className={`p-2.5 mb-2 rounded-lg cursor-pointer transition-all ${selectedAssociate?.['Associate ID'] === associate['Associate ID'] ? 'bg-blue-100 border-l-4 border-blue-500' : 'bg-gray-50 hover:bg-gray-100'}`}
                            onClick={() => handleSelectAssociate(associate)}
                          >
                            <p className="font-medium text-gray-800 text-sm">{associate.Name}</p>
                            <p className="text-xs text-gray-500">ID: {associate['Associate ID']} | Rank: {getLevelTitle(associate.Level)}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-500 text-center py-4">No associates found.</p>
                      )}
                    </div>
                </div>

                <div className="lg:col-span-2 bg-white p-4 rounded-lg shadow-md">
                    {selectedAssociate ? (
                        <div className="max-h-[80vh] overflow-y-auto pr-2">
                            <h2 className="text-2xl font-bold text-gray-800 mb-2">{selectedAssociate.Name}</h2>
                            <p className="text-md text-gray-600 mb-4">ID: {selectedAssociate['Associate ID']}</p>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                <div className="bg-gray-50 p-4 rounded-lg shadow-sm">
                                  <p className="text-gray-800"><span className="font-semibold">Rank:</span> {getLevelTitle(selectedAssociate.Level)}</p>
                                  <p className="text-gray-800"><span className="font-semibold">Depth Level:</span> {selectedAssociate['Depth Level']}</p>
                                </div>
                                <div className="bg-blue-50 p-4 rounded-lg">
                                    <h4 className="text-lg font-medium text-blue-700">Personal Premium</h4>
                                    <p className="text-gray-800"><span className="font-semibold">MTD:</span> ${selectedAssociate['Personal Premium MTD']?.toFixed(2) || '0.00'}</p>
                                    <p className="text-gray-800"><span className="font-semibold">PMTD:</span> ${selectedAssociate['Personal Premium PMTD']?.toFixed(2) || '0.00'}</p>
                                    <p className="text-gray-800"><span className="font-semibold">YTD:</span> ${selectedAssociate['Personal Premium YTD']?.toFixed(2) || '0.00'}</p>
                                </div>
                                <div className="bg-yellow-50 p-4 rounded-lg">
                                    <h4 className="text-lg font-medium text-yellow-700">Personal Recruits</h4>
                                    <p className="text-gray-800"><span className="font-semibold">MTD:</span> {selectedAssociate['Personal Recruits MTD'] || 0}</p>
                                    <p className="text-gray-800"><span className="font-semibold">PMTD:</span> {selectedAssociate['Personal Recruits PMTD'] || 0}</p>
                                    <p className="text-gray-800"><span className="font-semibold">YTD:</span> {selectedAssociate['Personal Recruits YTD'] || 0}</p>
                                </div>
                            </div>

                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            <p>{associateData.length > 0 ? "Select an associate to view details." : "Upload a CSV file to begin."}</p>
                        </div>
                    )}
                </div>
            </section>
        </main>
      </div>
    </div>
  );
};

export default App;
