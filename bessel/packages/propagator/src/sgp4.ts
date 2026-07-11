// SGP4 near-Earth propagator (Vallado AIAA-2006-6753, WGS-72). Propagates a TLE's
// mean elements to a TEME state at tsince minutes from epoch. Deep-space (SDP4) is
// out of scope here (period < 225 min). Pure. (STK_PARITY_SPEC §4.1, PROP-4.)

import type { Tle } from './tle.ts';

// WGS-72 constants.
const RE = 6378.135; // km
const MU = 398600.8;
const XKE = 60.0 / Math.sqrt((RE * RE * RE) / MU);
const J2 = 0.001082616;
const J3 = -0.00000253881;
const J4 = -0.00000165597;
const J3OJ2 = J3 / J2;
const X2O3 = 2.0 / 3.0;
const TWO_PI = 2 * Math.PI;
const VKMS = (RE * XKE) / 60.0; // km/s per (er/min)

export interface SatRec {
  no: number; // mean motion (rad/min), Kozai-recovered
  ecco: number;
  inclo: number;
  nodeo: number;
  argpo: number;
  mo: number;
  bstar: number;
  ao: number;
  con41: number;
  x1mth2: number;
  x7thm1: number;
  cosio: number;
  sinio: number;
  mdot: number;
  argpdot: number;
  nodedot: number;
  nodecf: number;
  cc1: number;
  cc4: number;
  cc5: number;
  t2cof: number;
  omgcof: number;
  xmcof: number;
  eta: number;
  isimp: boolean;
  d2: number;
  d3: number;
  d4: number;
  t3cof: number;
  t4cof: number;
  t5cof: number;
  delmo: number;
  sinmao: number;
  xlcof: number;
  aycof: number;
}

/** Initialize an SGP4 satellite record from a parsed TLE. */
export function sgp4init(tle: Tle): SatRec {
  const ecco = tle.eccentricity;
  const inclo = tle.inclination;
  const nodeo = tle.raan;
  const argpo = tle.argp;
  const mo = tle.meanAnomaly;
  const bstar = tle.bstar;
  const noKozai = (tle.meanMotion * TWO_PI) / 1440.0; // rad/min

  const cosio = Math.cos(inclo);
  const cosio2 = cosio * cosio;
  const sinio = Math.sin(inclo);
  const eccsq = ecco * ecco;
  const omeosq = 1 - eccsq;
  const rteosq = Math.sqrt(omeosq);

  // Recover the un-Kozai'd mean motion and semi-major axis.
  const ak = (XKE / noKozai) ** X2O3;
  const d1 = (0.75 * J2 * (3 * cosio2 - 1)) / (rteosq * omeosq);
  let delPrime = d1 / (ak * ak);
  const adel = ak * (1 - delPrime * delPrime - delPrime * (1 / 3 + (134 * delPrime * delPrime) / 81));
  delPrime = d1 / (adel * adel);
  const no = noKozai / (1 + delPrime);

  const ao = (XKE / no) ** X2O3;
  const con42 = 1 - 5 * cosio2;
  const con41 = -con42 - cosio2 - cosio2; // 3cos^2 - 1
  const x1mth2 = 1 - cosio2;
  const x7thm1 = 7 * cosio2 - 1;
  const cosio4 = cosio2 * cosio2;
  const betao2 = omeosq;
  const betao = rteosq;

  // Atmospheric drag s4 / qzms24 from perigee.
  const perige = (ao * (1 - ecco) - 1) * RE;
  let sfour = 78 / RE + 1;
  let qzms24 = ((120 - 78) / RE) ** 4;
  if (perige < 156) {
    let s = perige - 78;
    if (perige < 98) s = 20;
    qzms24 = ((120 - s) / RE) ** 4;
    sfour = s / RE + 1;
  }
  const pinvsq = 1 / (ao * ao * betao2 * betao2);
  const tsi = 1 / (ao - sfour);
  const eta = ao * ecco * tsi;
  const etasq = eta * eta;
  const eeta = ecco * eta;
  const psisq = Math.abs(1 - etasq);
  const coef = qzms24 * tsi ** 4;
  const coef1 = coef / psisq ** 3.5;
  const cc2 =
    coef1 *
    no *
    (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) +
      ((0.375 * J2 * tsi) / psisq) * con41 * (8 + 3 * etasq * (8 + etasq)));
  const cc1 = bstar * cc2;
  let cc3 = 0;
  if (ecco > 1e-4) cc3 = (-2 * coef * tsi * J3OJ2 * no * sinio) / ecco;
  const cc4 =
    2 *
    no *
    coef1 *
    ao *
    omeosq *
    (eta * (2 + 0.5 * etasq) +
      ecco * (0.5 + 2 * etasq) -
      ((J2 * tsi) / (ao * psisq)) *
        (-3 * con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) +
          0.75 * x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * argpo)));
  const cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);

  const temp1 = 1.5 * J2 * pinvsq * no;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * no;
  const mdot = no + 0.5 * temp1 * betao * con41 + 0.0625 * temp2 * betao * (13 - 78 * cosio2 + 137 * cosio4);
  const argpdot =
    -0.5 * temp1 * con42 +
    0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) +
    temp3 * (3 - 36 * cosio2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  const nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;

  const omgcof = bstar * cc3 * Math.cos(argpo);
  let xmcof = 0;
  if (ecco > 1e-4) xmcof = (-X2O3 * coef * bstar) / eeta;
  const nodecf = 3.5 * omeosq * xhdot1 * cc1;
  const t2cof = 1.5 * cc1;
  const xlcof = (-0.25 * J3OJ2 * sinio * (3 + 5 * cosio)) / (1 + cosio);
  const aycof = -0.5 * J3OJ2 * sinio;
  const delmo = (1 + eta * Math.cos(mo)) ** 3;
  const sinmao = Math.sin(mo);

  const isimp = ao * (1 - ecco) < 220 / RE + 1;
  let d2 = 0;
  let d3 = 0;
  let d4 = 0;
  let t3cof = 0;
  let t4cof = 0;
  let t5cof = 0;
  if (!isimp) {
    const cc1sq = cc1 * cc1;
    d2 = 4 * ao * tsi * cc1sq;
    const temp = (d2 * tsi * cc1) / 3;
    d3 = (17 * ao + sfour) * temp;
    d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * cc1;
    t3cof = d2 + 2 * cc1sq;
    t4cof = 0.25 * (3 * d3 + cc1 * (12 * d2 + 10 * cc1sq));
    t5cof = 0.2 * (3 * d4 + 12 * cc1 * d3 + 6 * d2 * d2 + 15 * cc1sq * (2 * d2 + cc1sq));
  }

  return {
    no, ecco, inclo, nodeo, argpo, mo, bstar, ao, con41, x1mth2, x7thm1, cosio, sinio,
    mdot, argpdot, nodedot, nodecf, cc1, cc4, cc5, t2cof, omgcof, xmcof, eta, isimp,
    d2, d3, d4, t3cof, t4cof, t5cof, delmo, sinmao, xlcof, aycof,
  };
}

export interface TemeState {
  readonly position: readonly [number, number, number]; // km
  readonly velocity: readonly [number, number, number]; // km/s
}

/** Propagate to tsince minutes from epoch; returns a TEME state. */
export function sgp4(s: SatRec, tsince: number): TemeState {
  const t = tsince;
  const xmdf = s.mo + s.mdot * t;
  const argpdf = s.argpo + s.argpdot * t;
  const nodedf = s.nodeo + s.nodedot * t;
  let argpm = argpdf;
  let mm = xmdf;
  const t2 = t * t;
  const nodem = nodedf + s.nodecf * t2;
  let tempa = 1 - s.cc1 * t;
  let tempe = s.bstar * s.cc4 * t;
  let templ = s.t2cof * t2;
  if (!s.isimp) {
    const delomg = s.omgcof * t;
    const delm = s.xmcof * ((1 + s.eta * Math.cos(xmdf)) ** 3 - s.delmo);
    const temp = delomg + delm;
    mm = xmdf + temp;
    argpm = argpdf - temp;
    const t3 = t2 * t;
    const t4 = t3 * t;
    tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
    tempe = tempe + s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
    templ = templ + s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
  }

  const am = (XKE / s.no) ** X2O3 * tempa * tempa;
  const em = s.ecco - tempe;
  const nm = XKE / am ** 1.5;
  mm = mm + s.no * templ;

  let xlm = mm + argpm + nodem;
  const nodemMod = ((nodem % TWO_PI) + TWO_PI) % TWO_PI;
  argpm = ((argpm % TWO_PI) + TWO_PI) % TWO_PI;
  xlm = ((xlm % TWO_PI) + TWO_PI) % TWO_PI;
  mm = ((xlm - argpm - nodemMod) % TWO_PI + TWO_PI) % TWO_PI;

  // Long-period periodics.
  const axnl = em * Math.cos(argpm);
  const temp = 1 / (am * (1 - em * em));
  const aynl = em * Math.sin(argpm) + temp * s.aycof;
  const xl = mm + argpm + nodemMod + temp * s.xlcof * axnl;

  // Kepler's equation for (E + omega).
  const u = (((xl - nodemMod) % TWO_PI) + TWO_PI) % TWO_PI;
  let eo1 = u;
  for (let ktr = 0; ktr < 10; ktr++) {
    const sineo1 = Math.sin(eo1);
    const coseo1 = Math.cos(eo1);
    let tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 += tem5;
    if (Math.abs(tem5) < 1e-12) break;
  }

  const sineo1 = Math.sin(eo1);
  const coseo1 = Math.cos(eo1);
  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1 - el2);
  const rl = am * (1 - ecose);
  const rdotl = (Math.sqrt(am) * esine) / rl;
  const rvdotl = Math.sqrt(pl) / rl;
  const betal = Math.sqrt(1 - el2);
  const temp0 = esine / (1 + betal);
  const sinu = (am / rl) * (sineo1 - aynl - axnl * temp0);
  const cosu = (am / rl) * (coseo1 - axnl + aynl * temp0);
  let su = Math.atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu;
  const cos2u = 1 - 2 * sinu * sinu;
  const temp00 = 1 / pl;
  const temp1 = 0.5 * J2 * temp00;
  const temp2 = temp1 * temp00;

  // Short-period periodics.
  const mrt = rl * (1 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
  su = su - 0.25 * temp2 * s.x7thm1 * sin2u;
  const xnode = nodemMod + 1.5 * temp2 * s.cosio * sin2u;
  const xinc = s.inclo + 1.5 * temp2 * s.cosio * s.sinio * cos2u;
  const mvt = rdotl - (nm * temp1 * s.x1mth2 * sin2u) / XKE;
  const rvdot = rvdotl + (nm * temp1 * (s.x1mth2 * cos2u + 1.5 * s.con41)) / XKE;

  // Orientation and state.
  const sinsu = Math.sin(su);
  const cossu = Math.cos(su);
  const snod = Math.sin(xnode);
  const cnod = Math.cos(xnode);
  const sini = Math.sin(xinc);
  const cosi = Math.cos(xinc);
  const xmx = -snod * cosi;
  const xmy = cnod * cosi;
  const ux = xmx * sinsu + cnod * cossu;
  const uy = xmy * sinsu + snod * cossu;
  const uz = sini * sinsu;
  const vx = xmx * cossu - cnod * sinsu;
  const vy = xmy * cossu - snod * sinsu;
  const vz = sini * cossu;

  return {
    position: [mrt * ux * RE, mrt * uy * RE, mrt * uz * RE],
    velocity: [(mvt * ux + rvdot * vx) * VKMS, (mvt * uy + rvdot * vy) * VKMS, (mvt * uz + rvdot * vz) * VKMS],
  };
}
