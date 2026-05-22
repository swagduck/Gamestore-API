import User from '../models/User';

const ACHIEVEMENTS = {
  FIRST_BLOOD: 'FIRST_BLOOD',
  GAMER: 'GAMER',
  SOCIAL_BUTTERFLY: 'SOCIAL_BUTTERFLY',
  BIG_SPENDER: 'BIG_SPENDER'
};

const addExpAndCheckBadges = async (userId: any, expGained: any, context = {}) => {
  try {
    const user = await User.findById(userId);
    if (!user) return null;

    // 1. Add EXP and process Level Ups
    user.exp += expGained;
    
    let leveledUp = false;
    let requiredExp = user.level * 100;
    
    while (user.exp >= requiredExp) {
      user.exp -= requiredExp;
      user.level += 1;
      leveledUp = true;
      requiredExp = user.level * 100;
    }

    // 2. Check Achievements
    if (!user.achievements) {
      user.achievements = [];
    }
    
    // @ts-ignore - TODO: Fix TS error
    const awardBadge = (badgeId) => {
      if (!user.achievements.includes(badgeId)) {
        user.achievements.push(badgeId);
      }
    };

    // Check BIG_SPENDER
    if (user.level >= 5) {
      awardBadge(ACHIEVEMENTS.BIG_SPENDER);
    }

    // Check FIRST_BLOOD and GAMER
    // @ts-ignore - TODO: Fix TS error
    if (context.gamesBought) {
      // @ts-ignore - TODO: Fix TS error
      if (context.gamesBought >= 1) {
        awardBadge(ACHIEVEMENTS.FIRST_BLOOD);
      }
      // @ts-ignore - TODO: Fix TS error
      if (context.gamesBought >= 3) {
        awardBadge(ACHIEVEMENTS.GAMER);
      }
    }

    // Check SOCIAL_BUTTERFLY
    if (user.friends && user.friends.length >= 3) {
      awardBadge(ACHIEVEMENTS.SOCIAL_BUTTERFLY);
    }

    await user.save();
    return {
      exp: user.exp,
      level: user.level,
      achievements: user.achievements,
      leveledUp
    };
  } catch (error) {
    console.error('Error in leveling system:', error);
    return null;
  }
};

export {
  ACHIEVEMENTS,
  addExpAndCheckBadges
};
