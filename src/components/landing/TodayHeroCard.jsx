import React from 'react';
import RecipeCard from '../RecipeCard.jsx';

export default function TodayHeroCard({ meal, onPress }) {
  if (!meal || meal._special) return null;
  return (
    <RecipeCard
      meal={meal}
      layout="hero"
      statusBadge="Tonight's Dinner"
      onClick={onPress}
    />
  );
}
