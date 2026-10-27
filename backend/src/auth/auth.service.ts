import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Usuario } from '../entities/usuario.entity';
import { LoginDto } from './dto/login.dto';
import { JwtUser } from './current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const usuario = await this.usuarios.findOne({
      where: { email: dto.email },
    });
    if (!usuario || usuario.ativo !== 1) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const ok = await bcrypt.compare(dto.senha, usuario.senha_hash);
    if (!ok) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const payload: JwtUser = {
      sub: usuario.id,
      email: usuario.email,
      perfil: usuario.perfil,
      nome: usuario.nome,
    };

    return {
      token: await this.jwt.signAsync(payload),
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil,
      },
    };
  }
}
