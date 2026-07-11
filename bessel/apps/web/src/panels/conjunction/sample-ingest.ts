// Small, valid sample documents for the conjunction ingestion card's "Load sample" button, so
// the REAL ingestion + screen + per-event Pc flow is runnable (and e2e-testable) without an
// external file. These are parsed by the same REAL parsers as any pasted document (nothing here
// is a synthetic SampledEphemeris); they are just minimal valid CCSDS/TLE text fixtures.
//
// The CDM carries two inertial state vectors that sit ~2 km apart near the TCA (so the screen
// flags the pair below a few-km threshold) plus per-object RTN covariances (so the per-event
// full-covariance Pc has real covariances to propagate). The OEM has two short segments whose
// states close within a few km. The TLE set has two near-coplanar objects.

/** A CCSDS CDM (508.0 KVN) with the relative summary, two inertial state vectors, and per-object
 *  RTN covariances. OBJECT1/OBJECT2 sit ~2 km apart near the TCA with nearly co-aligned velocity,
 *  so the rectilinear screen brackets a sub-threshold close approach. */
export const SAMPLE_CDM = `CCSDS_CDM_VERS = 1.0
CREATION_DATE = 2026-06-01T00:00:00.000
ORIGINATOR = BESSEL
MESSAGE_ID = 2026060100_conj_demo

TCA = 2026-06-02T00:00:00.000
MISS_DISTANCE = 2000 [m]
RELATIVE_SPEED = 120 [m/s]

OBJECT = OBJECT1
OBJECT_DESIGNATOR = PRIMARY-A
OBJECT_NAME = PRIMARY A
X = 7000.000 [km]
Y = 0.000 [km]
Z = 0.000 [km]
X_DOT = 0.000000 [km/s]
Y_DOT = 7.546000 [km/s]
Z_DOT = 0.000000 [km/s]
CR_R = 0.010000 [km**2]
CT_R = 0.000000 [km**2]
CT_T = 0.040000 [km**2]
CN_R = 0.000000 [km**2]
CN_T = 0.000000 [km**2]
CN_N = 0.020000 [km**2]

OBJECT = OBJECT2
OBJECT_DESIGNATOR = SECONDARY-B
OBJECT_NAME = SECONDARY B
X = 7000.000 [km]
Y = 0.000 [km]
Z = 2.000 [km]
X_DOT = 0.000000 [km/s]
Y_DOT = 7.546000 [km/s]
Z_DOT = 0.030000 [km/s]
CR_R = 0.020000 [km**2]
CT_R = 0.000000 [km**2]
CT_T = 0.060000 [km**2]
CN_R = 0.000000 [km**2]
CN_T = 0.000000 [km**2]
CN_N = 0.030000 [km**2]
`;

/** Two short CCSDS OEM (502.0 KVN) segments whose tabulated states close within a few km. The two
 *  objects share the in-plane track but cross with a small out-of-plane (Z) relative velocity, so
 *  near the segment midpoint they pass ~2 km apart with a NON-ZERO relative velocity. That non-zero
 *  relative velocity is required: the encounter plane (normal to the relative velocity) is undefined
 *  for two co-velocity objects, so an analyst-supplied covariance could not yield a full-covariance
 *  Pc if the pair moved in lockstep. The tabulated in-plane velocity is the segment's own slope
 *  (-2000 km over 1800 s in X, +6000 km in Y), so the states are self-consistent. */
export const SAMPLE_OEM = `CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-06-01T00:00:00
ORIGINATOR = BESSEL
META_START
OBJECT_NAME = SAT-OEM-1
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = ICRF
TIME_SYSTEM = UTC
START_TIME = 2026-06-02T00:00:00.000
STOP_TIME = 2026-06-02T00:30:00.000
META_STOP
2026-06-02T00:00:00.000 7000.000 0.000 0.000 -1.111111 3.333333 0.000000
2026-06-02T00:30:00.000 5000.000 6000.000 0.000 -1.111111 3.333333 0.000000

CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-06-01T00:00:00
ORIGINATOR = BESSEL
META_START
OBJECT_NAME = SAT-OEM-2
OBJECT_ID = 2026-002A
CENTER_NAME = EARTH
REF_FRAME = ICRF
TIME_SYSTEM = UTC
START_TIME = 2026-06-02T00:00:00.000
STOP_TIME = 2026-06-02T00:30:00.000
META_STOP
2026-06-02T00:00:00.000 7000.000 2.000 -5.000 -1.111111 3.333333 0.005556
2026-06-02T00:30:00.000 5000.000 6002.000 5.000 -1.111111 3.333333 0.005556
`;

/** A two-object TLE set (named), near-coplanar LEO. Parsed via parseTle + SGP4. */
export const SAMPLE_TLE_SET = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9997
2 25544  51.6400 208.9163 0006317  69.9862 290.2024 15.49000000    02
STARLINK-DEMO
1 44713U 19074A   24001.50000000  .00001234  00000-0  90000-4 0  9995
2 44713  53.0540 100.0000 0001500  90.0000 270.0000 15.06000000    05
`;
