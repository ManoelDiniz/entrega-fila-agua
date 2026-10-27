import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Produto } from '../entities/produto.entity';
import { CreateProdutoDto } from './dto/create-produto.dto';
import { UpdateProdutoDto } from './dto/update-produto.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class ProdutosService {
  constructor(
    @InjectRepository(Produto)
    private readonly repo: Repository<Produto>,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Por padrão devolve TUDO, inclusive os desativados — a tela de gestão precisa
   * listar e reativar produto desativado. O filtro é opt-in (`?ativo=1`), usado
   * pela tela de pedido, onde vender produto inativo não faz sentido.
   */
  findAll(apenasAtivos = false) {
    return this.repo.find({
      where: apenasAtivos ? { ativo: 1 } : {},
      order: { ativo: 'DESC', nome: 'ASC' },
    });
  }

  async findOne(id: string) {
    const produto = await this.repo.findOne({ where: { id } });
    if (!produto) throw new NotFoundException('Produto não encontrado.');
    return produto;
  }

  async create(dto: CreateProdutoDto) {
    const produto = await this.repo.save(
      this.repo.create({
        nome: dto.nome,
        preco: dto.preco.toFixed(2),
        ativo: dto.ativo ?? 1,
      }),
    );
    this.realtime.emitProdutoAtualizado({ id: produto.id, acao: 'criado' });
    return produto;
  }

  /**
   * Alterar o preço aqui NÃO mexe em pedidos já feitos: `pedido_itens.preco_unit`
   * guarda o preço do momento da venda. É de propósito — o histórico financeiro
   * não pode mudar retroativamente porque alguém reajustou a tabela.
   *
   * Não há exclusão: `ativo: 0` desativa. A FK de `pedido_itens` é ON DELETE
   * RESTRICT, então apagar um produto já vendido levaria o histórico junto.
   */
  async update(id: string, dto: UpdateProdutoDto) {
    const produto = await this.findOne(id);

    if (dto.nome !== undefined) produto.nome = dto.nome;
    if (dto.preco !== undefined) produto.preco = dto.preco.toFixed(2);
    if (dto.ativo !== undefined) produto.ativo = dto.ativo;

    const salvo = await this.repo.save(produto);
    this.realtime.emitProdutoAtualizado({ id: salvo.id, acao: 'alterado' });
    return salvo;
  }
}
