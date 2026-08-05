const Club = require('../models/Club.model');
const User = require('../models/User.model');
const Task = require('../models/Task.model');
const Event = require('../models/Event.model');
const AuditLog = require('../models/AuditLog.model');
const { logger } = require('../config/logger');
const { invalidateClub } = require('../services/cache.service');

// @desc    Get all clubs
// @route   GET /api/clubs
// @access  Public/Private
exports.getAllClubs = async (req, res) => {
  try {
    const { page = 1, limit = 10, category, visibility, search } = req.query;

    const query = { isActive: true };

    // Filter by category
    if (category) {
      query.category = category;
    }

    // Filter by visibility (if user is logged in, show all; otherwise only public)
    if (visibility) {
      query.visibility = visibility;
    } else if (!req.user) {
      query.visibility = 'public';
    }

    // Search by name
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const clubs = await Club.find(query)
      .populate('createdBy', 'name email profilePhoto')
      .populate('members.user', 'name email profilePhoto')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await Club.countDocuments(query);

    res.status(200).json({
      success: true,
      data: clubs,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count
    });
  } catch (error) {
    logger.error(`Get All Clubs Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error fetching clubs'
    });
  }
};

// @desc    Create new club
// @route   POST /api/clubs
// @access  Private
exports.createClub = async (req, res) => {
  try {
    const { name, description, category, visibility } = req.body;

    // Create club
    const club = await Club.create({
      name,
      description,
      category,
      visibility,
      createdBy: req.user._id,
      members: [{
        user: req.user._id,
        role: 'president',
        joinedAt: new Date()
      }]
    });

    // Add club to user's clubs
    await req.user.joinClub(club._id, 'president');

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'club_created',
      entityType: 'Club',
      entityId: club._id,
      description: `Created club: ${name}`,
      metadata: {
        clubId: club._id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      }
    });

    const populatedClub = await Club.findById(club._id)
      .populate('createdBy', 'name email profilePhoto')
      .populate('members.user', 'name email profilePhoto');

    res.status(201).json({
      success: true,
      message: 'Club created successfully',
      data: populatedClub
    });
  } catch (error) {
    logger.error(`Create Club Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error creating club'
    });
  }
};

// @desc    Get club by ID
// @route   GET /api/clubs/:clubId
// @access  Public/Private
exports.getClubById = async (req, res) => {
  try {
    const club = await Club.findById(req.params.clubId)
      .populate('createdBy', 'name email profilePhoto')
      .populate('members.user', 'name email profilePhoto')
      .populate('members.invitedBy', 'name email');

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    // Check if user can view private club
    if (club.visibility === 'private' && req.user) {
      const isMember = club.isMember(req.user._id);
      if (!isMember && req.user.role !== 'superadmin') {
        return res.status(403).json({
          success: false,
          message: 'This club is private'
        });
      }
    }

    res.status(200).json({
      success: true,
      data: club
    });
  } catch (error) {
    logger.error(`Get Club Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error fetching club'
    });
  }
};

// @desc    Update club
// @route   PUT /api/clubs/:clubId
// @access  Private (Club Admin)
exports.updateClub = async (req, res) => {
  try {
    const { name, description, category, visibility, logo, coverImage } = req.body;

    const club = await Club.findById(req.params.clubId);

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    // Update fields
    if (name) club.name = name;
    if (description !== undefined) club.description = description;
    if (category) club.category = category;
    if (visibility) club.visibility = visibility;
    if (logo) club.logo = logo;
    if (coverImage) club.coverImage = coverImage;

    await club.save();
    await invalidateClub(club._id);

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'club_updated',
      entityType: 'Club',
      entityId: club._id,
      description: `Updated club: ${club.name}`,
      metadata: {
        clubId: club._id,
        changes: req.body
      }
    });

    const updatedClub = await Club.findById(club._id)
      .populate('createdBy', 'name email profilePhoto')
      .populate('members.user', 'name email profilePhoto');

    res.status(200).json({
      success: true,
      message: 'Club updated successfully',
      data: updatedClub
    });
  } catch (error) {
    logger.error(`Update Club Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error updating club'
    });
  }
};

// @desc    Delete club
// @route   DELETE /api/clubs/:clubId
// @access  Private (President)
exports.deleteClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.clubId);

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    // Soft delete
    club.isActive = false;
    await club.save();
    await invalidateClub(club._id);

    // Remove club from all members
    await User.updateMany(
      { 'clubs.club': club._id },
      { $pull: { clubs: { club: club._id } } }
    );

    // Archive all tasks and events
    await Task.updateMany({ club: club._id }, { isArchived: true });
    await Event.updateMany({ club: club._id }, { isCancelled: true });

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'club_deleted',
      entityType: 'Club',
      entityId: club._id,
      description: `Deleted club: ${club.name}`,
      severity: 'warning',
      metadata: {
        clubId: club._id
      }
    });

    res.status(200).json({
      success: true,
      message: 'Club deleted successfully'
    });
  } catch (error) {
    logger.error(`Delete Club Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error deleting club'
    });
  }
};

// @desc    Join club
// @route   POST /api/clubs/:clubId/join
// @access  Private
exports.joinClub = async (req, res) => {
  try {
    const { inviteToken } = req.body;
    const club = await Club.findById(req.params.clubId);

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    // Check if already a member
    if (club.isMember(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'Already a member of this club'
      });
    }

    // Verify invite token if club is private
    if (club.visibility === 'private') {
      if (!inviteToken || inviteToken !== club.inviteToken) {
        return res.status(403).json({
          success: false,
          message: 'Invalid invite token'
        });
      }

      if (!club.isInviteTokenValid()) {
        return res.status(403).json({
          success: false,
          message: 'Invite token has expired'
        });
      }
    }

    // Add member to club
    await club.addMember(req.user._id, 'member');
    await req.user.joinClub(club._id, 'member');

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'member_added',
      entityType: 'Club',
      entityId: club._id,
      description: `${req.user.name} joined club: ${club.name}`,
      metadata: {
        clubId: club._id
      }
    });

    res.status(200).json({
      success: true,
      message: 'Successfully joined club',
      data: club
    });
  } catch (error) {
    logger.error(`Join Club Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message || 'Error joining club'
    });
  }
};

// @desc    Leave club
// @route   POST /api/clubs/:clubId/leave
// @access  Private
exports.leaveClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.clubId);

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    // Check if member
    if (!club.isMember(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'Not a member of this club'
      });
    }

    // Check if president
    if (club.isPresident(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'President cannot leave club. Transfer ownership first.'
      });
    }

    // Remove member
    await club.removeMember(req.user._id);
    await req.user.leaveClub(club._id);

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'member_removed',
      entityType: 'Club',
      entityId: club._id,
      description: `${req.user.name} left club: ${club.name}`,
      metadata: {
        clubId: club._id
      }
    });

    res.status(200).json({
      success: true,
      message: 'Successfully left club'
    });
  } catch (error) {
    logger.error(`Leave Club Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error leaving club'
    });
  }
};

// @desc    Get club members
// @route   GET /api/clubs/:clubId/members
// @access  Private
exports.getClubMembers = async (req, res) => {
  try {
    const club = await Club.findById(req.params.clubId)
      .populate('members.user', 'name email profilePhoto lastLogin')
      .populate('members.invitedBy', 'name email');

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    res.status(200).json({
      success: true,
      data: club.members
    });
  } catch (error) {
    logger.error(`Get Club Members Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error fetching club members'
    });
  }
};

// @desc    Add member to club
// @route   POST /api/clubs/:clubId/members
// @access  Private (Club Admin)
exports.addMember = async (req, res) => {
  try {
    const { userId, role = 'member' } = req.body;

    const club = await Club.findById(req.params.clubId);

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await club.addMember(userId, role, req.user._id);
    await user.joinClub(club._id, role);

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'member_added',
      entityType: 'Club',
      entityId: club._id,
      description: `Added ${user.name} to club: ${club.name}`,
      metadata: {
        clubId: club._id,
        addedUserId: userId,
        role
      }
    });

    res.status(200).json({
      success: true,
      message: 'Member added successfully'
    });
  } catch (error) {
    logger.error(`Add Member Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message || 'Error adding member'
    });
  }
};

// @desc    Remove member from club
// @route   DELETE /api/clubs/:clubId/members/:userId
// @access  Private (Club Admin)
exports.removeMember = async (req, res) => {
  try {
    const { userId } = req.params;

    const club = await Club.findById(req.params.clubId);

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    // Cannot remove president
    if (club.isPresident(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Cannot remove president. Transfer ownership first.'
      });
    }

    const user = await User.findById(userId);

    await club.removeMember(userId);
    if (user) {
      await user.leaveClub(club._id);
    }

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'member_removed',
      entityType: 'Club',
      entityId: club._id,
      description: `Removed member from club: ${club.name}`,
      metadata: {
        clubId: club._id,
        removedUserId: userId
      }
    });

    res.status(200).json({
      success: true,
      message: 'Member removed successfully'
    });
  } catch (error) {
    logger.error(`Remove Member Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error removing member'
    });
  }
};

// @desc    Update member role
// @route   PUT /api/clubs/:clubId/members/:userId/role
// @access  Private (VP+)
exports.updateMemberRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    const club = await Club.findById(req.params.clubId);

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Cannot change president role
    if (club.isPresident(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Cannot change president role. Use transfer ownership.'
      });
    }

    await club.updateMemberRole(userId, role);
    await user.updateClubRole(club._id, role);

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'member_role_changed',
      entityType: 'Club',
      entityId: club._id,
      description: `Changed ${user.name}'s role to ${role} in club: ${club.name}`,
      metadata: {
        clubId: club._id,
        targetUserId: userId,
        newRole: role
      }
    });

    res.status(200).json({
      success: true,
      message: 'Member role updated successfully'
    });
  } catch (error) {
    logger.error(`Update Member Role Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating member role'
    });
  }
};

// @desc    Generate invite link
// @route   POST /api/clubs/:clubId/invite
// @access  Private (Club Admin)
exports.generateInviteLink = async (req, res) => {
  try {
    const club = await Club.findById(req.params.clubId);

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    const token = club.generateInviteToken();
    await club.save();

    const inviteLink = `${process.env.CLIENT_URL}/clubs/join/${club._id}?token=${token}`;

    res.status(200).json({
      success: true,
      data: {
        inviteToken: token,
        inviteLink,
        expiresAt: club.inviteTokenExpiry
      }
    });
  } catch (error) {
    logger.error(`Generate Invite Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error generating invite link'
    });
  }
};

// @desc    Transfer ownership
// @route   POST /api/clubs/:clubId/transfer
// @access  Private (President)
exports.transferOwnership = async (req, res) => {
  try {
    const { newPresidentId } = req.body;

    const club = await Club.findById(req.params.clubId);

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    const newPresident = await User.findById(newPresidentId);

    if (!newPresident) {
      return res.status(404).json({
        success: false,
        message: 'New president not found'
      });
    }

    await club.transferOwnership(req.user._id, newPresidentId);
    await req.user.updateClubRole(club._id, 'member');
    await newPresident.updateClubRole(club._id, 'president');

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'member_role_changed',
      entityType: 'Club',
      entityId: club._id,
      description: `Transferred ownership to ${newPresident.name}`,
      severity: 'warning',
      metadata: {
        clubId: club._id,
        newPresidentId
      }
    });

    res.status(200).json({
      success: true,
      message: 'Ownership transferred successfully'
    });
  } catch (error) {
    logger.error(`Transfer Ownership Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message || 'Error transferring ownership'
    });
  }
};
