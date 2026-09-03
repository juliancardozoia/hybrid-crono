/**
 * Motor de puntuacion. Puro: sin DOM, sin React, sin Supabase.
 *
 * Corre identico en el cliente y en el servidor, igual que src/shared/timing/,
 * y por la misma razon: el leaderboard en vivo y el oficial no pueden diferir.
 */

export * from "./types";
export * from "./points";
export * from "./normalize";
export * from "./place";
export * from "./overall";
export * from "./scoreboard";
export * from "./fromTiming";
