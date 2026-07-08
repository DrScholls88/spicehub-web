import { motion } from 'framer-motion';

/**
 * RoomTransition — the "walk through the doorway" trip between My Bar and the
 * Saloon. A full-screen veil zooms a pixel doorway toward the viewer (camera
 * pushing through the door) while it briefly darkens the screen, masking the
 * hard swap of the two room overlays underneath. Purely presentational and
 * self-timed; the parent mounts it for the duration of the trip.
 *
 * trip: 'toSaloon' | 'toMyBar'
 * The parent swaps the underlying rooms at ~the veil's opaque apex (~400ms).
 */
export default function RoomTransition({ trip }) {
  if (!trip) return null;
  const toSaloon = trip === 'toSaloon';
  const label = toSaloon ? 'Stepping into the Saloon…' : 'Back to your bar…';

  return (
    <motion.div
      className={`room-trip room-trip--${trip}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration: 0.85, times: [0, 0.42, 0.6, 1], ease: 'easeInOut' }}
      aria-hidden="true"
    >
      <div className="room-trip-stage">
        {/* Tunnel rings give parallax depth as the camera pushes forward */}
        <motion.span
          className="room-trip-ring room-trip-ring--far"
          initial={{ scale: 0.1, opacity: 0 }}
          animate={{ scale: [0.1, 2.4, 7], opacity: [0, 0.9, 0] }}
          transition={{ duration: 0.85, times: [0, 0.5, 1], ease: 'easeIn' }}
        />
        <motion.span
          className="room-trip-ring room-trip-ring--near"
          initial={{ scale: 0.05, opacity: 0 }}
          animate={{ scale: [0.05, 1.4, 9], opacity: [0, 1, 0] }}
          transition={{ duration: 0.85, times: [0, 0.5, 1], ease: 'easeIn' }}
        />
        {/* The doorway itself, rushing toward the viewer with a little yaw */}
        <motion.span
          className="room-trip-door"
          initial={{ scale: 0.16, rotateY: toSaloon ? -14 : 14, opacity: 0 }}
          animate={{
            scale: [0.16, 1, 8],
            rotateY: [toSaloon ? -14 : 14, 0, 0],
            opacity: [0, 1, 0],
          }}
          transition={{ duration: 0.85, times: [0, 0.5, 1], ease: 'easeIn' }}
        />
      </div>
      <motion.span
        className="room-trip-label"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: [0, 1, 1, 0], y: [8, 0, 0, -6] }}
        transition={{ duration: 0.85, times: [0, 0.35, 0.65, 1], ease: 'easeOut' }}
      >
        {label}
      </motion.span>
    </motion.div>
  );
}
