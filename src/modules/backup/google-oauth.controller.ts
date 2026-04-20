import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as express from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { GoogleDriveStorage } from './storage/google-drive.storage';

const OAUTH_STATE_COOKIE = 'erp_drive_state';

/**
 * Google OAuth flow cannot carry an Authorization header through a browser redirect.
 * We mint a short-lived "state" JWT when the super admin clicks Connect, and verify it
 * on the callback — giving us CSRF protection plus super-admin identity binding.
 */
@ApiTags('Backup / Google Drive')
@Controller('backup/google')
export class GoogleOAuthController {
  constructor(
    private readonly drive: GoogleDriveStorage,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {}

  @Get('status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @RequirePermissions('backup:list')
  @ApiOperation({ summary: 'Check Google Drive connection status' })
  async status() {
    return this.drive.getAccountInfo();
  }

  @Post('auth')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @RequirePermissions('backup:export')
  @ApiOperation({ summary: 'Begin Google Drive OAuth — returns URL to open' })
  async beginAuth(@Req() req: express.Request, @Res() res: express.Response) {
    const u: any = (req as any).user;
    const state = this.jwt.sign(
      { purpose: 'drive-oauth', sub: u.userId ?? u._id?.toString() },
      { expiresIn: '10m' },
    );
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV') === 'production',
      maxAge: 10 * 60 * 1000,
    });
    const url = this.drive.generateAuthUrl(state);
    res.json({ url });
  }

  @Get('callback')
  @ApiOperation({ summary: 'OAuth callback — consumed by Google redirect' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Req() req: express.Request,
    @Res() res: express.Response,
  ) {
    const frontendBase = this.resolveFrontendBase(req);
    const closeWindow = (status: 'success' | 'error', message?: string) => {
      const url = new URL('/dashboard/settings/backup', frontendBase);
      url.searchParams.set('google', status);
      if (message) url.searchParams.set('message', message);
      res.redirect(url.toString());
    };

    try {
      if (error) {
        return closeWindow('error', `Google returned: ${error}`);
      }
      if (!code || !state) {
        return closeWindow('error', 'Missing code or state');
      }

      // Verify state was minted by us recently
      let statePayload: any;
      try {
        statePayload = this.jwt.verify(state);
      } catch {
        return closeWindow('error', 'Invalid or expired state');
      }
      if (statePayload.purpose !== 'drive-oauth' || !statePayload.sub) {
        return closeWindow('error', 'State mismatch');
      }

      // Re-verify user is still a super admin
      const user = await this.userModel.findById(statePayload.sub).lean();
      if (!user || !user.isActive) {
        return closeWindow('error', 'User not authorized');
      }
      let permissions: string[] = [];
      if (user.role) {
        const role = await this.roleModel.findById(user.role).lean();
        if (role) permissions = role.permissions ?? [];
      }
      if (!permissions.includes('*') && !permissions.includes('backup:export')) {
        return closeWindow('error', 'Forbidden');
      }

      const { email } = await this.drive.exchangeCodeAndPersist(code);
      return closeWindow('success', email ? `Connected as ${email}` : 'Connected');
    } catch (err: any) {
      return closeWindow('error', err?.message ?? 'OAuth failed');
    }
  }

  @Post('disconnect')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @RequirePermissions('backup:export')
  @ApiOperation({ summary: 'Revoke the stored Google Drive connection' })
  async disconnect() {
    await this.drive.disconnect();
    return { success: true };
  }

  private resolveFrontendBase(req: express.Request): string {
    const origin = this.config.get<string>('FRONTEND_URL');
    if (origin) return origin;
    const cors = this.config.get<string>('CORS_ORIGIN', '');
    const first = cors.split(',').map((s) => s.trim()).filter(Boolean).find((v) => v !== '*');
    if (first) return first;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    return `${proto}://${req.get('host')}`;
  }
}
