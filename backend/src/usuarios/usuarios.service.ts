import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Usuario } from '../entities/usuario.entity';
import { CreateUsuarioDto } from './dto/create-usuario.dto';

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private readonly repo: Repository<Usuario>,
  ) {}

  async findAll() {
    const list = await this.repo.find({ order: { criado_em: 'DESC' } });
    return list.map((u) => this.semSenha(u));
  }

  async findOne(id: string) {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('Usuário não encontrado.');
    return this.semSenha(u);
  }

  async create(dto: CreateUsuarioDto) {
    const senha_hash = await bcrypt.hash(dto.senha, 10);
    const usuario = this.repo.create({
      nome: dto.nome,
      email: dto.email,
      senha_hash,
      perfil: dto.perfil,
      telefone: dto.telefone ?? null,
      ativo: dto.ativo === false ? 0 : 1,
    });
    const salvo = await this.repo.save(usuario);
    return this.semSenha(salvo);
  }

  private semSenha(u: Usuario) {
    const { senha_hash, ...resto } = u;
    void senha_hash;
    return resto;
  }
}
